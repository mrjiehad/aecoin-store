import { Hono } from 'hono';
import { CloudflareBindings } from '../types';
import { verifyToyyibPaySignature } from '../lib/crypto';
import { EmailService } from '../lib/email/sendCodes';
import { initBillplzGateway } from '../lib/gateway/billplz';
import { initStripeGateway } from '../lib/gateway/stripe';
import { initPayPalGateway } from '../lib/gateway/paypal';
import { ToyyibPayGateway } from '../lib/gateway/toyyibpay';

export const webhookRoutes = new Hono<{ Bindings: CloudflareBindings }>();

// POST /api/webhook/toyyibpay - Handle ToyyibPay webhook
webhookRoutes.post('/toyyibpay', async (c) => {
  try {
    const { DB, TOYYIBPAY_SECRET_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL } = c.env;
    
    // Get webhook data
    const formData = await c.req.formData();
    const billCode = formData.get('billcode') as string;
    const orderNumber = formData.get('order_id') as string;
    const statusId = formData.get('status_id') as string; // 1 = success, 2 = pending, 3 = failed
    const billpaymentStatus = formData.get('billpaymentStatus') as string;
    const transactionId = formData.get('transaction_id') as string;
    const signature = formData.get('signature') as string;
    
    // Log webhook received
    console.log('ToyyibPay webhook received:', {
      billCode,
      orderNumber,
      statusId,
      billpaymentStatus,
      transactionId
    });
    
    // Find order
    const order = await DB.prepare(`
      SELECT * FROM orders 
      WHERE order_number = ? OR gateway_bill_code = ?
    `).bind(orderNumber || '', billCode || '').first();
    
    if (!order) {
      console.error('Order not found for webhook:', { orderNumber, billCode });
      return c.text('OK'); // Return OK to prevent retries
    }
    
    // Check idempotency - if already processed, skip
    if (order.status === 'paid' && order.gateway_ref) {
      console.log('Order already processed:', order.order_number);
      return c.text('OK');
    }
    
    // Process based on status
    if (statusId === '1' && billpaymentStatus === '1') {
      // Payment successful
      
      // Update order status
      await DB.prepare(`
        UPDATE orders 
        SET status = 'paid', 
            gateway_ref = ?, 
            paid_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(transactionId, order.id).run();
      
      // Log payment completed event
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'payment_completed',
        JSON.stringify({ transactionId, billCode })
      ).run();
      
      // Reserve coupon codes
      await DB.prepare(`
        UPDATE coupon_codes 
        SET is_used = 1, 
            used_by_email = ?, 
            order_id = ?,
            reserved_at = datetime('now')
        WHERE id IN (
          SELECT id FROM coupon_codes 
          WHERE product_id = ? AND is_used = 0 
          LIMIT ?
        )
      `).bind(
        order.email,
        order.id,
        order.product_id,
        order.quantity
      ).run();
      
      // Get the updated codes
      const codes = await DB.prepare(`
        SELECT * FROM coupon_codes 
        WHERE product_id = ? AND is_used = 1 AND used_by_email = ? AND order_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).bind(order.product_id, order.email, order.id, order.quantity).all();
      
      if (!codes.results || codes.results.length < order.quantity) {
        // Handle insufficient codes - should not happen if stock was properly checked
        console.error('Insufficient codes for order:', order.order_number);
        
        // Log error but don't fail the webhook
        await DB.prepare(`
          INSERT INTO order_events (order_id, type, payload, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(
          order.id,
          'codes_error',
          JSON.stringify({ 
            error: 'Insufficient codes', 
            requested: order.quantity,
            available: codes.results?.length || 0
          })
        ).run();
      } else {
        // Get product info
        const product = await DB.prepare(`
          SELECT title FROM products WHERE id = ?
        `).bind(order.product_id).first();
        
        // Send email with codes
        try {
          const emailService = new EmailService(RESEND_API_KEY, RESEND_FROM_EMAIL);
          await emailService.sendCouponCodes(
            order,
            codes.results,
            product?.title || 'AECOIN Package'
          );
          
          // Log codes sent event
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'codes_sent',
            JSON.stringify({ 
              codes: codes.results.map((code: any) => code.code),
              email: order.email
            })
          ).run();
          
        } catch (emailError: any) {
          console.error('Failed to send email:', emailError);
          // Log error but don't fail the webhook
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'email_error',
            JSON.stringify({ error: emailError?.message || 'Unknown email error' })
          ).run();
        }
        
        // Create AK4Y redeem code in FiveM database
        try {
          const mysql = (await import('mysql2/promise')).default;
          
          const creditMultiplier = Number(c.env.AK4Y_CREDIT_PER_AE || 1);
          const creditsToGrant = Math.max(1, Math.floor((product.amount_ae || 0) * creditMultiplier) * (order.quantity || 1));
          
          console.log(`Creating FiveM redeem code for order ${order.order_number} with ${creditsToGrant} credits`);
          
          const connection = await mysql.createConnection({
            host: c.env.FIVEM_DB_HOST,
            user: c.env.FIVEM_DB_USER,
            password: c.env.FIVEM_DB_PASSWORD || '',
            database: c.env.FIVEM_DB_NAME,
            port: Number(c.env.FIVEM_DB_PORT || 3306)
          });
          
          const insertQuery = `
            INSERT INTO redeem_codes (code, amount, created_at, redeemed) 
            VALUES (?, ?, NOW(), 0)
          `;
          
          await connection.execute(insertQuery, [order.order_number, creditsToGrant]);
          await connection.end();
          
          console.log(`✅ FiveM redeem code created: ${order.order_number} = ${creditsToGrant} credits`);
          
          // Log FiveM code creation event
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'fivem_code_created',
            JSON.stringify({ 
              orderNumber: order.order_number,
              credits: creditsToGrant,
              fivemDatabase: c.env.FIVEM_DB_NAME
            })
          ).run();
          
        } catch (fivemError: any) {
          console.error('Failed to create FiveM redeem code:', fivemError);
          // Log error but don't fail the webhook
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'fivem_error',
            JSON.stringify({ error: fivemError?.message || 'Unknown FiveM error' })
          ).run();
        }
      }
      
    } else if (statusId === '3') {
      // Payment failed
      await DB.prepare(`
        UPDATE orders 
        SET status = 'failed', 
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(order.id).run();
      
      // Log payment failed event
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'payment_failed',
        JSON.stringify({ statusId, billpaymentStatus })
      ).run();
    }
    
    return c.text('OK');
    
  } catch (error) {
    console.error('Webhook error:', error);
    // Return OK to prevent retries that might cause issues
    return c.text('OK');
  }
});

// POST /api/webhook/billplz - Handle Billplz webhook
webhookRoutes.post('/billplz', async (c) => {
  try {
    const { DB, RESEND_API_KEY, RESEND_FROM_EMAIL } = c.env;
    
    // Get webhook data (Billplz sends as form data)
    const formData = await c.req.formData();
    
    // Parse webhook data
    const webhookData = {
      id: formData.get('id') as string,
      collection_id: formData.get('collection_id') as string,
      paid: formData.get('paid') === 'true',
      state: formData.get('state') as string,
      amount: formData.get('amount') as string,
      paid_amount: formData.get('paid_amount') as string,
      due_at: formData.get('due_at') as string,
      email: formData.get('email') as string,
      mobile: formData.get('mobile') as string,
      name: formData.get('name') as string,
      url: formData.get('url') as string,
      paid_at: formData.get('paid_at') as string,
      x_signature: formData.get('x_signature') as string,
      transaction_id: formData.get('transaction_id') as string,
      transaction_status: formData.get('transaction_status') as string,
    };
    
    // Log webhook received
    console.log('Billplz webhook received:', {
      billId: webhookData.id,
      paid: webhookData.paid,
      state: webhookData.state,
      amount: webhookData.amount,
      transactionId: webhookData.transaction_id
    });
    
    // Initialize Billplz gateway to verify signature
    const billplz = initBillplzGateway(c.env);
    
    // Process webhook
    const result = await billplz.processWebhook(webhookData);
    
    // Find order by bill ID
    const order = await DB.prepare(`
      SELECT * FROM orders 
      WHERE gateway_bill_code = ?
    `).bind(webhookData.id).first();
    
    if (!order) {
      console.error('Order not found for Billplz webhook:', webhookData.id);
      return c.text('OK'); // Return OK to prevent retries
    }
    
    // Check idempotency - if already processed, skip
    if (order.status === 'paid' && order.gateway_ref) {
      console.log('Order already processed:', order.order_number);
      return c.text('OK');
    }
    
    // Process based on payment status
    if (result.paid) {
      // Payment successful
      
      // Get product info for code allocation
      const product = await DB.prepare(`
        SELECT * FROM products WHERE id = ?
      `).bind(order.product_id).first();
      
      if (!product) {
        console.error('Product not found:', order.product_id);
        return c.text('OK');
      }
      
      // Allocate codes for the order
      await DB.prepare(`
        UPDATE coupon_codes 
        SET is_used = true, 
            used_by_email = ?,
            order_id = ?,
            used_at = datetime('now')
        WHERE product_id = ? 
          AND is_used = false
        LIMIT ?
      `).bind(
        order.email,
        order.id,
        order.product_id,
        order.quantity
      ).run();
      
      // Get the allocated codes
      const codes = await DB.prepare(`
        SELECT * FROM coupon_codes 
        WHERE product_id = ? AND is_used = true AND used_by_email = ? AND order_id = ?
        ORDER BY id DESC
        LIMIT ?
      `).bind(order.product_id, order.email, order.id, order.quantity).all();
      
      if (codes.results.length < order.quantity) {
        console.error('Insufficient codes available:', {
          required: order.quantity,
          available: codes.results.length
        });
        
        // Update order status to failed
        await DB.prepare(`
          UPDATE orders 
          SET status = 'failed',
              gateway_ref = ?,
              notes = 'Insufficient codes available',
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(result.transactionId, order.id).run();
        
        return c.text('OK');
      }
      
      // Update order status
      await DB.prepare(`
        UPDATE orders 
        SET status = 'paid',
            paid_at = datetime('now'),
            gateway_ref = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(result.transactionId, order.id).run();
      
      // Log payment success event
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'payment_success',
        JSON.stringify({
          transactionId: result.transactionId,
          amount: result.amount,
          billId: result.billId
        })
      ).run();
      
      // Send codes via email
      if (RESEND_API_KEY && RESEND_FROM_EMAIL) {
        try {
          const emailService = new EmailService(RESEND_API_KEY, RESEND_FROM_EMAIL);
          await emailService.sendActivationCodes(
            order.email,
            order.order_number,
            codes.results.map(c => c.code),
            product.title,
            order.subtotal
          );
          
          // Log email sent event
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'codes_sent',
            JSON.stringify({ 
              codes: codes.results.map(c => c.code),
              email: order.email
            })
          ).run();
          
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
          // Log error but don't fail the webhook
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'email_error',
            JSON.stringify({ error: emailError.message })
          ).run();
        }
      }
      
    } else if (webhookData.state === 'due') {
      // Payment pending/due
      await DB.prepare(`
        UPDATE orders 
        SET status = 'pending',
            gateway_ref = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(result.transactionId, order.id).run();
      
    } else {
      // Payment failed or cancelled
      await DB.prepare(`
        UPDATE orders 
        SET status = 'failed',
            gateway_ref = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(result.transactionId, order.id).run();
      
      // Log payment failed event
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'payment_failed',
        JSON.stringify({ 
          state: webhookData.state,
          billId: webhookData.id
        })
      ).run();
    }
    
    return c.text('OK');
    
  } catch (error) {
    console.error('Billplz webhook error:', error);
    // Return OK to prevent retries that might cause issues
    return c.text('OK');
  }
});

// POST /api/webhook/stripe - Handle Stripe webhook (Simplified)
webhookRoutes.post('/stripe', async (c) => {
  try {
    console.log('🔔 Stripe webhook received');
    
    const { DB } = c.env;
    
    // Get raw body
    const rawBody = await c.req.text();
    const event = JSON.parse(rawBody);
    
    console.log('📝 Webhook event:', {
      type: event.type,
      id: event.id
    });
    
    // Handle checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderNumber = session.metadata?.order_number;
      
      console.log('💳 Payment completed:', {
        orderNumber,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total
      });
      
      if (!orderNumber) {
        console.error('❌ No order number in session metadata');
        return c.json({ received: true });
      }
      
      // Find order by order number
      const order = await DB.prepare(`
        SELECT * FROM orders 
        WHERE order_number = ?
      `).bind(orderNumber).first();
      
      if (!order) {
        console.error('❌ Order not found:', orderNumber);
        return c.json({ received: true });
      }
      
      console.log('📦 Found order:', {
        id: order.id,
        status: order.status,
        productId: order.product_id,
        quantity: order.quantity
      });
      
      // Check if already processed
      if (order.status === 'paid') {
        console.log('✅ Order already processed:', orderNumber);
        return c.json({ received: true });
      }
      
      // Check payment status
      if (session.payment_status === 'paid') {
        console.log('💰 Payment successful, processing order...');
        
        // Get product info first
        const product = await DB.prepare(`
          SELECT * FROM products WHERE id = ?
        `).bind(order.product_id).first();
        
        if (!product) {
          console.error('❌ Product not found:', order.product_id);
          return c.json({ received: true });
        }
        
        console.log('🎁 Product found:', {
          title: product.title,
          amountAe: product.amount_ae
        });
        
        // Update order status to paid
        await DB.prepare(`
          UPDATE orders 
          SET status = 'paid',
              paid_at = datetime('now'),
              gateway_ref = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(session.payment_intent || session.id, order.id).run();
        
        console.log('✅ Order status updated to paid');
        
        // Log payment success event
        await DB.prepare(`
          INSERT INTO order_events (order_id, type, payload, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(
          order.id,
          'payment_success',
          JSON.stringify({
            sessionId: session.id,
            paymentIntent: session.payment_intent,
            amount: session.amount_total
          })
        ).run();
        
        // Create AK4Y redeem code in FiveM database
        try {
          // Calculate credits based on product amount
          const creditMultiplier = Number(c.env.AK4Y_CREDIT_PER_AE || 1);
          const creditsToGrant = Math.max(1, Math.floor((product.amount_ae || 0) * creditMultiplier) * (order.quantity || 1));
          
          console.log('🎮 Creating FiveM redeem code:', {
            code: orderNumber,
            credits: creditsToGrant
          });
          
          if (c.env.FIVEM_DB_HOST && c.env.FIVEM_DB_USER && c.env.FIVEM_DB_NAME) {
            // Import MySQL connection function
            const { insertRedeemCode } = await import('../lib/fivem-mysql.js');
              
            // Insert code directly into FiveM database
            await insertRedeemCode({
              host: c.env.FIVEM_DB_HOST,
              user: c.env.FIVEM_DB_USER,
              password: c.env.FIVEM_DB_PASSWORD || '',
              database: c.env.FIVEM_DB_NAME,
              port: Number(c.env.FIVEM_DB_PORT || 3306)
            }, orderNumber, creditsToGrant);
            
            console.log('🎉 SUCCESS! Redeem code created in FiveM database:', {
              code: orderNumber,
              credits: creditsToGrant
            });
            
            // Log successful code creation
            await DB.prepare(`
              INSERT INTO order_events (order_id, type, payload, created_at)
              VALUES (?, ?, ?, datetime('now'))
            `).bind(
              order.id,
              'ak4y_code_created',
              JSON.stringify({ 
                code: orderNumber, 
                credit: creditsToGrant,
                method: 'mysql_direct',
                note: 'Use this order number as redeem code in-game'
              })
            ).run();
          } else {
            console.log('⚠️ FiveM database configuration not available - using order number as redeem code');
            
            // Log that redeem code is available (order number can be used as code)
            await DB.prepare(`
              INSERT INTO order_events (order_id, type, payload, created_at)
              VALUES (?, ?, ?, datetime('now'))
            `).bind(
              order.id,
              'ak4y_code_ready',
              JSON.stringify({ 
                code: orderNumber, 
                credit: creditsToGrant,
                method: 'order_number',
                note: 'Use order number as redeem code in-game'
              })
            ).run();
          }
        } catch (dbError) {
          console.error('❌ Failed to create FiveM redeem code:', dbError);
        }
        
      } else {
        console.log('⚠️ Payment not completed:', session.payment_status);
      }
    }
    
    return c.json({ received: true });
    
  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    return c.json({ received: true }); // Always return success to avoid retries
  }
});

// POST /api/webhook/test - Handle test webhook for development
webhookRoutes.post('/test', async (c) => {
  try {
    console.log('🧪 Test webhook received');
    
    const { DB } = c.env;
    const body = await c.req.json();
    
    console.log('Test webhook payload:', body);
    
    const { order_number, status, test } = body;
    
    if (!order_number) {
      console.error('❌ No order number provided');
      return c.json({ error: 'Order number required' }, 400);
    }
    
    // Find order by order number
    const order = await DB.prepare(`
      SELECT * FROM orders 
      WHERE order_number = ?
    `).bind(order_number).first();
    
    if (!order) {
      console.error('❌ Order not found:', order_number);
      return c.json({ error: 'Order not found' }, 404);
    }
    
    console.log('📦 Found order:', {
      id: order.id,
      status: order.status,
      productId: order.product_id,
      quantity: order.quantity
    });
    
    // Check if already processed
    if (order.status === 'paid') {
      console.log('✅ Order already processed:', order_number);
      return c.json({ received: true, message: 'Already processed' });
    }
    
    // Process based on status
    if (status === 'success') {
      console.log('💰 Test payment successful, processing order...');
      
      // Get product info
      const product = await DB.prepare(`
        SELECT * FROM products WHERE id = ?
      `).bind(order.product_id).first();
      
      if (!product) {
        console.error('❌ Product not found:', order.product_id);
        return c.json({ error: 'Product not found' }, 404);
      }
      
      console.log('🎁 Product found:', {
        title: product.title,
        amountAe: product.amount_ae
      });
      
      // Update order status to paid
      await DB.prepare(`
        UPDATE orders 
        SET status = 'paid',
            paid_at = datetime('now'),
            gateway_ref = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind('TEST_' + Date.now(), order.id).run();
      
      console.log('✅ Order status updated to paid');
      
      // Log payment completed event
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'test_payment_completed',
        JSON.stringify({ test: true, order_number })
      ).run();
      
      // Create AK4Y redeem code in FiveM database (optional)
      try {
        if (c.env.FIVEM_DB_HOST && c.env.FIVEM_DB_USER && c.env.FIVEM_DB_NAME) {
          // Calculate credits based on product amount
          const creditMultiplier = Number(c.env.AK4Y_CREDIT_PER_AE || 1);
          const creditsToGrant = Math.max(1, Math.floor((product.amount_ae || 0) * creditMultiplier) * (order.quantity || 1));
          
          console.log('🎮 Creating FiveM redeem code:', {
            code: order_number,
            credits: creditsToGrant
          });
          
        // Import MySQL connection function
        const { insertRedeemCode } = await import('../lib/fivem-mysql.js');
          
          // Insert code directly into FiveM database
          await insertRedeemCode({
            host: c.env.FIVEM_DB_HOST,
            user: c.env.FIVEM_DB_USER,
            password: c.env.FIVEM_DB_PASSWORD || '',
            database: c.env.FIVEM_DB_NAME,
            port: Number(c.env.FIVEM_DB_PORT || 3306)
          }, order_number, creditsToGrant);
          
          console.log('🎉 SUCCESS! Test redeem code ready:', {
            code: order_number,
            credits: creditsToGrant,
            note: 'Use order number as redeem code'
          });
          
          // Log successful code creation
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'ak4y_code_created',
            JSON.stringify({ 
              code: order_number, 
              credit: creditsToGrant,
              method: 'mysql_direct',
              note: 'Use this order number as redeem code in-game'
            })
          ).run();
          
          console.log('🎉 SUCCESS! FiveM redeem code created in database:', {
            code: order_number,
            credits: creditsToGrant
          });
          
        } else {
          console.log('⚠️ FiveM database configuration not available - using order number as redeem code');
        }
      } catch (dbError) {
        console.error('❌ Failed to create FiveM redeem code:', dbError);
      }
      
      return c.json({ 
        received: true, 
        message: 'Test payment processed successfully',
        order_number,
        status: 'paid'
      });
      
    } else {
      console.log('❌ Test payment failed');
      
      // Update order status to failed
      await DB.prepare(`
        UPDATE orders 
        SET status = 'failed',
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(order.id).run();
      
      // Log payment failed event
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'test_payment_failed',
        JSON.stringify({ test: true, order_number })
      ).run();
      
      return c.json({ 
        received: true, 
        message: 'Test payment failed',
        order_number,
        status: 'failed'
      });
    }
    
  } catch (error) {
    console.error('❌ Test webhook error:', error);
    return c.json({ error: 'Test webhook processing failed' }, 500);
  }
});

// POST /api/webhook/paypal - Handle PayPal webhook
webhookRoutes.post('/paypal', async (c) => {
  try {
    console.log('🔵 PayPal webhook received');
    
    const { DB } = c.env;
    
    // Get raw body
    const rawBody = await c.req.text();
    const event = JSON.parse(rawBody);
    
    console.log('📝 PayPal webhook event:', {
      event_type: event.event_type,
      id: event.id
    });
    
    // Handle checkout order approved/completed events
    if (event.event_type === 'CHECKOUT.ORDER.APPROVED' || event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const resource = event.resource;
      const orderNumber = resource.purchase_units?.[0]?.reference_id || resource.purchase_units?.[0]?.custom_id;
      
      console.log('💳 PayPal payment event:', {
        orderNumber,
        paypalOrderId: resource.id,
        status: resource.status
      });
      
      if (!orderNumber) {
        console.error('❌ No order number in PayPal webhook');
        return c.json({ received: true });
      }
      
      // Find order by order number
      const order = await DB.prepare(`
        SELECT * FROM orders 
        WHERE order_number = ?
      `).bind(orderNumber).first();
      
      if (!order) {
        console.error('❌ Order not found:', orderNumber);
        return c.json({ received: true });
      }
      
      console.log('📦 Found PayPal order:', {
        id: order.id,
        status: order.status,
        productId: order.product_id,
        quantity: order.quantity
      });
      
      // Check if already processed
      if (order.status === 'paid') {
        console.log('✅ PayPal order already processed:', orderNumber);
        return c.json({ received: true });
      }
      
      // Process the payment
      console.log('💰 PayPal payment successful, processing order...');
      
      // Get product info first
      const product = await DB.prepare(`
        SELECT * FROM products WHERE id = ?
      `).bind(order.product_id).first();
      
      if (!product) {
        console.error('❌ Product not found:', order.product_id);
        return c.json({ received: true });
      }
      
      console.log('🎁 Product found:', {
        title: product.title,
        amountAe: product.amount_ae
      });
      
      // Update order status to paid
      await DB.prepare(`
        UPDATE orders 
        SET status = 'paid',
            paid_at = datetime('now'),
            gateway_ref = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(resource.id, order.id).run();
      
      console.log('✅ PayPal order status updated to paid');
      
      // Log payment success event
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'payment_success',
        JSON.stringify({
          paypalOrderId: resource.id,
          eventType: event.event_type,
          status: resource.status
        })
      ).run();
      
      // Create AK4Y redeem code in FiveM database
      try {
        // Calculate credits based on product amount
        const creditMultiplier = Number(c.env.AK4Y_CREDIT_PER_AE || 1);
        const creditsToGrant = Math.max(1, Math.floor((product.amount_ae || 0) * creditMultiplier) * (order.quantity || 1));
        
        console.log('🎮 Creating FiveM redeem code:', {
          code: orderNumber,
          credits: creditsToGrant
        });
        
        if (c.env.FIVEM_DB_HOST && c.env.FIVEM_DB_USER && c.env.FIVEM_DB_NAME) {
          // Import MySQL connection function
          const { insertRedeemCode } = await import('../lib/fivem-mysql.js');
            
          // Insert code directly into FiveM database
          await insertRedeemCode({
            host: c.env.FIVEM_DB_HOST,
            user: c.env.FIVEM_DB_USER,
            password: c.env.FIVEM_DB_PASSWORD || '',
            database: c.env.FIVEM_DB_NAME,
            port: Number(c.env.FIVEM_DB_PORT || 3306)
          }, orderNumber, creditsToGrant);
          
          console.log('🎉 SUCCESS! PayPal redeem code created in FiveM database:', {
            code: orderNumber,
            credits: creditsToGrant
          });
          
          // Log successful code creation
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'ak4y_code_created',
            JSON.stringify({ 
              code: orderNumber, 
              credit: creditsToGrant,
              method: 'mysql_direct',
              note: 'Use this order number as redeem code in-game'
            })
          ).run();
        } else {
          console.log('⚠️ FiveM database configuration not available - using order number as redeem code');
          
          // Log that redeem code is available (order number can be used as code)
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'ak4y_code_ready',
            JSON.stringify({ 
              code: orderNumber, 
              credit: creditsToGrant,
              method: 'order_number',
              note: 'Use order number as redeem code in-game'
            })
          ).run();
        }
      } catch (dbError) {
        console.error('❌ Failed to create FiveM redeem code:', dbError);
      }
    }
    
    return c.json({ received: true });
    
  } catch (error) {
    console.error('❌ PayPal webhook error:', error);
    return c.json({ received: true }); // Always return success to avoid retries
  }
});

// POST /api/webhook/manual-complete - Manual webhook to complete payment for testing
webhookRoutes.post('/manual-complete', async (c) => {
  try {
    console.log('🔧 Manual payment completion webhook received');
    
    const { DB } = c.env;
    const body = await c.req.json();
    
    const { order_number, force } = body;
    
    if (!order_number) {
      console.error('❌ No order number provided');
      return c.json({ error: 'Order number required' }, 400);
    }
    
    // Find order by order number
    const order = await DB.prepare(`
      SELECT * FROM orders 
      WHERE order_number = ?
    `).bind(order_number).first();
    
    if (!order) {
      console.error('❌ Order not found:', order_number);
      return c.json({ received: true, message: 'Order not found', order_number }, 404);
    }
    
    if (order.status === 'paid' && !force) {
      console.log('✅ Order already processed:', order_number);
      return c.json({ received: true, message: 'Already processed', order_number, status: 'paid' });
    }
    
    console.log('💰 Manual payment completion, processing order...');
    
    // Update order status to paid
    await DB.prepare(`
      UPDATE orders 
      SET status = 'paid',
          paid_at = datetime('now'),
          gateway_ref = 'manual_completion',
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(order.id).run();
    
    console.log('✅ Order status updated to paid');
    
    // Log payment success event
    await DB.prepare(`
      INSERT INTO order_events (order_id, type, payload, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).bind(
      order.id,
      'manual_payment_completion',
      JSON.stringify({ order_number, manual: true })
    ).run();
    
    // Create AK4Y redeem code in FiveM database
    try {
      const product = await DB.prepare(`
        SELECT amount_ae FROM products WHERE id = ?
      `).bind(order.product_id).first();
      
      if (!product) {
        console.error('🎁 Product not found for order:', order_number);
        await DB.prepare(`
          INSERT INTO order_events (order_id, type, payload, created_at)
          VALUES (?, ?, ?, datetime('now'))
        `).bind(
          order.id,
          'ak4y_product_error',
          JSON.stringify({ error: 'Product not found for redeem code generation' })
        ).run();
      } else {
        console.log('🎁 Product found:', product);
        
        if (c.env.FIVEM_DB_HOST && c.env.FIVEM_DB_USER && c.env.FIVEM_DB_NAME) {
          // Calculate credits based on product amount
          const creditMultiplier = Number(c.env.AK4Y_CREDIT_PER_AE || 1);
          const creditsToGrant = Math.max(1, Math.floor((product.amount_ae || 0) * creditMultiplier) * (order.quantity || 1));
          
          console.log('🎮 Creating FiveM redeem code:', {
            code: order_number,
            credits: creditsToGrant
          });
          
          // Import MySQL connection function
          const { insertRedeemCode } = await import('../lib/fivem-mysql.js');
          
          // Insert code directly into FiveM database
          await insertRedeemCode({
            host: c.env.FIVEM_DB_HOST,
            user: c.env.FIVEM_DB_USER,
            password: c.env.FIVEM_DB_PASSWORD || '',
            database: c.env.FIVEM_DB_NAME,
            port: Number(c.env.FIVEM_DB_PORT || 3306)
          }, order_number, creditsToGrant);
          
          // Log successful code creation
          await DB.prepare(`
            INSERT INTO order_events (order_id, type, payload, created_at)
            VALUES (?, ?, ?, datetime('now'))
          `).bind(
            order.id,
            'ak4y_code_created',
            JSON.stringify({ 
              code: order_number, 
              credit: creditsToGrant,
              method: 'mysql_direct',
              note: 'Use this order number as redeem code in-game'
            })
          ).run();
          
          console.log('🎉 SUCCESS! FiveM redeem code created in database:', {
            code: order_number,
            credits: creditsToGrant
          });
          
        } else {
          console.log('⚠️ FiveM database configuration not available - using order number as redeem code');
        }
      }
    } catch (dbError) {
      console.error('❌ Failed to create FiveM redeem code:', dbError);
      await DB.prepare(`
        INSERT INTO order_events (order_id, type, payload, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).bind(
        order.id,
        'ak4y_code_error',
        JSON.stringify({ error: (dbError as Error).message || 'Unknown DB error' })
      ).run();
    }
    
    console.log('🎉 SUCCESS! Order marked as paid:', {
      order_number,
      status: 'paid'
    });
    
    return c.json({ 
      received: true, 
      message: 'Payment completed manually',
      order_number,
      status: 'paid'
    });
    
  } catch (error) {
    console.error('❌ Manual completion webhook error:', error);
    return c.json({ error: 'Manual completion failed' }, 500);
  }
});


