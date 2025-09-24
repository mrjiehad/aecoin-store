import { Hono } from 'hono';
import { CloudflareBindings, Order } from '../types';
import { z } from 'zod';
import { ToyyibPayGateway } from '../lib/gateway/toyyibpay';
import { initBillplzGateway } from '../lib/gateway/billplz';
import { createStripeCheckoutSession } from '../lib/stripe-simple';
import { initPayPalGateway } from '../lib/gateway/paypal';
import { generateOrderNumber } from '../lib/crypto';

export const checkoutRoutes = new Hono<{ Bindings: CloudflareBindings }>();

const checkoutSchema = z.object({
  email: z.string().email(),
  phone: z.string().min(10, 'Phone number must be at least 10 digits').max(11, 'Phone number must be at most 11 digits').optional(),
  items: z.array(z.object({
    product_id: z.number(),
    quantity: z.number().min(1).max(10)
  })).min(1),
  terms_accepted: z.boolean().refine(val => val === true, {
    message: 'You must accept the terms and conditions'
  }),
  payment_method: z.enum(['stripe', 'paypal', 'toyyibpay']).optional().default('stripe')
});

// POST /api/checkout - Process checkout
checkoutRoutes.post('/', async (c) => {
  try {
    const { DB, TOYYIBPAY_API_URL, TOYYIBPAY_SECRET_KEY, TOYYIBPAY_CATEGORY_CODE, APP_URL, KV } = c.env;
    const body = await c.req.json();
    
    // Validate request
    const validation = checkoutSchema.safeParse(body);
    if (!validation.success) {
      return c.json({ 
        success: false, 
        error: validation.error.errors[0]?.message || 'Invalid request' 
      }, 400);
    }
    
    const { email, phone, items, payment_method } = validation.data;
    
    // Rate limiting check (disabled for development)
    // const rateLimitKey = `checkout:${email}`;
    // const rateLimitCount = await KV.get(rateLimitKey);
    // if (rateLimitCount && parseInt(rateLimitCount) > 5) {
    //   return c.json({
    //     success: false,
    //     error: 'Too many checkout attempts. Please try again later.'
    //   }, 429);
    // }
    // 
    // // Update rate limit
    // await KV.put(rateLimitKey, (parseInt(rateLimitCount || '0') + 1).toString(), {
    //   expirationTtl: 3600 // 1 hour
    // });
    
    // For now, we'll process only the first item (single product checkout)
    const item = items[0];
    
    // Verify product and stock
    const product = await DB.prepare(`
      SELECT * FROM products WHERE id = ? AND is_active = 1
    `).bind(item.product_id).first();
    
    if (!product) {
      return c.json({ 
        success: false, 
        error: 'Product not found' 
      }, 404);
    }
    
    // Check stock
    const stockResult = await DB.prepare(`
      SELECT COUNT(*) as available
      FROM coupon_codes
      WHERE product_id = ? AND is_used = 0
    `).bind(item.product_id).first();
    
    if (!stockResult || stockResult.available < item.quantity) {
      return c.json({
        success: false,
        error: 'Insufficient stock available'
      }, 400);
    }
    
    // Calculate total
    const subtotal = product.price_now * item.quantity;
    
    // Create order
    const orderNumber = generateOrderNumber();
    
    const orderResult = await DB.prepare(`
      INSERT INTO orders (
        order_number, email, product_id, quantity, 
        subtotal, gateway, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      orderNumber,
      email,
      item.product_id,
      item.quantity,
      subtotal,
      'toyyibpay',
      'pending'
    ).run();
    
    const orderId = orderResult.meta.last_row_id;
    
    // Log order creation event
    await DB.prepare(`
      INSERT INTO order_events (order_id, type, payload, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).bind(
      orderId,
      'created',
      JSON.stringify({ email, items, subtotal })
    ).run();
    
    // Determine which gateway to use based on user selection and configuration
    const hasStripe = c.env.STRIPE_SECRET_KEY && 
                      !c.env.STRIPE_SECRET_KEY.includes('your_') &&
                      !c.env.STRIPE_SECRET_KEY.includes('test_key');
    const hasBillplz = c.env.BILLPLZ_API_KEY && 
                       c.env.BILLPLZ_COLLECTION_ID && 
                       !c.env.BILLPLZ_API_KEY.includes('test') &&
                       !c.env.BILLPLZ_API_KEY.includes('dev');
    const hasToyyibPay = c.env.TOYYIBPAY_SECRET_KEY && 
                        c.env.TOYYIBPAY_CATEGORY_CODE &&
                        !c.env.TOYYIBPAY_SECRET_KEY.includes('test') &&
                        !c.env.TOYYIBPAY_SECRET_KEY.includes('dev');
    
    // Use selected payment method if available, otherwise fallback
    let useGateway = payment_method;
    
    // Check if we have Stripe configured (including test keys)
    const stripeConfigured = c.env.STRIPE_SECRET_KEY && c.env.STRIPE_SECRET_KEY.startsWith('sk_');
    
    // Check if we have ToyyibPay configured
    const toyyibpayConfigured = c.env.TOYYIBPAY_SECRET_KEY && c.env.TOYYIBPAY_CATEGORY_CODE;
    
    // Check if we have PayPal configured
    const paypalConfigured = c.env.PAYPAL_CLIENT_ID && c.env.PAYPAL_CLIENT_SECRET;
    
    // Handle payment method selection
    if (payment_method === 'toyyibpay' && toyyibpayConfigured) {
      console.log('Using ToyyibPay payment gateway');
      
      try {
        console.log('🔵 Starting ToyyibPay checkout process...');
        
        const successUrl = `${APP_URL}/success?order=${orderNumber}&toyyibpay=true`;
        const callbackUrl = `${APP_URL}/api/webhook/toyyibpay`;
        
        // Get product details for ToyyibPay bill
        const product = await DB.prepare(`
          SELECT * FROM products WHERE id = ?
        `).bind(item.product_id).first();
        
        if (!product) {
          return c.json({
            success: false,
            error: 'Product not found'
          }, 404);
        }
        
        const toyyibpay = new ToyyibPayGateway(c.env.TOYYIBPAY_SECRET_KEY, c.env.TOYYIBPAY_CATEGORY_CODE);
        
        const result = await toyyibpay.createBill({
          orderNumber,
          amount: Math.round(subtotal), // Amount in ringgit (not cents)
          currency: 'MYR',
          description: `${product.title}`, // Shortened bill name
          customerName: email.split('@')[0],
          customerEmail: email,
          customerPhone: phone || '0123456789', // Use provided phone or default
          returnUrl: successUrl,
          callbackUrl: callbackUrl,
        });
        
        if (!result.success) {
          console.error('❌ Failed to create ToyyibPay bill:', result.error);
          throw new Error(result.error || 'Failed to create ToyyibPay bill');
        }
        
        console.log('✅ ToyyibPay bill created successfully');
        
        // Update order with ToyyibPay info
        await DB.prepare(`
          UPDATE orders 
          SET gateway = 'toyyibpay', 
              gateway_bill_code = ?,
              payment_url = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(result.data!.billCode, result.data!.billPaymentUrl, orderId).run();
        
        // Log payment initiated event
        await DB.prepare(`
          INSERT INTO order_events (order_id, type, payload, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(
          orderId,
          'payment_initiated',
          JSON.stringify({ 
            billCode: result.data!.billCode, 
            billPaymentUrl: result.data!.billPaymentUrl,
            gateway: 'toyyibpay'
          })
        ).run();
        
        return c.json({
          success: true,
          data: {
            order_number: orderNumber,
            payment_url: result.data!.billPaymentUrl,
            total: subtotal,
            gateway: 'toyyibpay',
            bill_code: result.data!.billCode
          }
        });
        
      } catch (toyyibpayError: any) {
        console.error('ToyyibPay error:', toyyibpayError);
        return c.json({
          success: false,
          error: 'ToyyibPay payment gateway error. Please try again later.'
        }, 500);
      }
    }
    
    // Handle payment method selection
    if (payment_method === 'paypal' && paypalConfigured) {
      console.log('Using PayPal payment gateway');
      
      try {
        console.log('🔵 Starting PayPal checkout process...');
        
        const successUrl = `${APP_URL}/success?order=${orderNumber}&paypal=true`;
        const cancelUrl = `${APP_URL}/checkout?canceled=true`;
        
        // Get product details for PayPal order
        const product = await DB.prepare(`
          SELECT * FROM products WHERE id = ?
        `).bind(item.product_id).first();
        
        if (!product) {
          return c.json({
            success: false,
            error: 'Product not found'
          }, 404);
        }
        
        const paypal = initPayPalGateway(c.env);
        
        const result = await paypal.createOrder({
          orderNumber,
          email,
          amount: Math.round(subtotal * 100), // Convert to cents
          currency: 'USD', // PayPal typically uses USD
          description: `${product.title} - AECOIN Purchase`,
          returnUrl: successUrl,
          cancelUrl: cancelUrl,
        });
        
        if (!result.success) {
          console.error('❌ Failed to create PayPal order:', result.error);
          throw new Error(result.error || 'Failed to create PayPal order');
        }
        
        console.log('✅ PayPal order created successfully');
        
        // Update order with PayPal info
        await DB.prepare(`
          UPDATE orders 
          SET gateway = 'paypal', 
              gateway_bill_code = ?,
              payment_url = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(result.data!.orderId, result.data!.approvalUrl, orderId).run();
        
        // Log payment initiated event
        await DB.prepare(`
          INSERT INTO order_events (order_id, type, payload, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(
          orderId,
          'payment_initiated',
          JSON.stringify({ 
            paypalOrderId: result.data!.orderId, 
            approvalUrl: result.data!.approvalUrl,
            gateway: 'paypal'
          })
        ).run();
        
        return c.json({
          success: true,
          data: {
            order_number: orderNumber,
            payment_url: result.data!.approvalUrl,
            total: subtotal,
            gateway: 'paypal',
            paypal_order_id: result.data!.orderId
          }
        });
        
      } catch (paypalError: any) {
        console.error('PayPal error:', paypalError);
        return c.json({
          success: false,
          error: 'PayPal payment gateway error. Please try again later.'
        }, 500);
      }
    }
    
    // If ToyyibPay is selected but not configured, return error
    if (payment_method === 'toyyibpay' && !toyyibpayConfigured) {
      console.error('ToyyibPay payment gateway not configured');
      return c.json({
        success: false,
        error: 'ToyyibPay payment gateway not available. Please contact support.'
      }, 503);
    }
    
    // If Stripe is configured, use it
    if (stripeConfigured) {
      console.log('Using Stripe payment gateway');
      
      try {
        console.log('🔵 Starting Stripe checkout process...');
        
        const successUrl = `${APP_URL}/success?order=${orderNumber}&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${APP_URL}/checkout?canceled=true`;
        
        // Get product details for line items
        const lineItems = [];
        for (const item of items) {
          const product = await DB.prepare(`
            SELECT * FROM products WHERE id = ?
          `).bind(item.product_id).first();
          
          if (product) {
            lineItems.push({
              name: product.title,
              description: `${product.amount_ae} AECOIN`,
              amount: Math.round(product.price_now * 100), // Convert to cents
              quantity: item.quantity,
            });
          }
        }
        
        console.log('🔵 Creating Stripe session with items:', lineItems);
        
        const result = await createStripeCheckoutSession(c.env, {
          orderNumber,
          email,
          items: lineItems,
          successUrl,
          cancelUrl,
        });
        
        if (!result.success) {
          console.error('❌ Failed to create Stripe session:', result.error);
          throw new Error(result.error || 'Failed to create Stripe session');
        }
        
        const session = result.data;
        console.log('✅ Stripe session created successfully');
        
        // Update order with Stripe session info
        await DB.prepare(`
          UPDATE orders 
          SET gateway = 'stripe', 
              gateway_bill_code = ?,
              payment_url = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(session.session_id, session.payment_url, orderId).run();
        
        // Log payment initiated event
        await DB.prepare(`
          INSERT INTO order_events (order_id, type, payload, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(
          orderId,
          'payment_initiated',
          JSON.stringify({ 
            sessionId: session.session_id, 
            paymentUrl: session.payment_url,
            gateway: 'stripe'
          })
        ).run();
        
        return c.json({
          success: true,
          data: {
            order_number: orderNumber,
            payment_url: session.payment_url,
            total: subtotal,
            gateway: 'stripe',
            session_id: session.session_id
          }
        });
        
      } catch (stripeError: any) {
        console.error('Stripe error:', stripeError);
        return c.json({
          success: false,
          error: 'Payment gateway error. Please try again later.'
        }, 500);
      }
    }
    
    // If no payment gateway is configured, return error
    console.error('No payment gateway configured');
    return c.json({
      success: false,
      error: 'Payment gateway not available. Please contact support.'
    }, 503);
    
  } catch (error) {
    console.error('Checkout error:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to process checkout' 
    }, 500);
  }
});