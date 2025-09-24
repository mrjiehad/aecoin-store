import { Hono } from 'hono';
import type { CloudflareBindings } from '../types';

export const simpleWebhookRoutes = new Hono<{ Bindings: CloudflareBindings }>();

// POST /api/webhook/simple - Simple webhook for manual testing
simpleWebhookRoutes.post('/simple', async (c) => {
  try {
    console.log('🔥 Simple webhook received');
    
    const { DB } = c.env;
    const body = await c.req.json();
    
    console.log('Simple webhook payload:', body);
    
    const { order_number, status = 'success' } = body;
    
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
    
    if (order.status === 'paid') {
      console.log('✅ Order already processed:', order_number);
      return c.json({ 
        received: true, 
        message: 'Already processed',
        order_number,
        status: 'paid'
      });
    }
    
    if (status === 'success') {
      console.log('💰 Processing successful payment...');
      
      // Update order status to paid
      await DB.prepare(`
        UPDATE orders 
        SET status = 'paid',
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(order.id).run();
      
      console.log('✅ Order status updated to paid');
      
      // Get product info
      const product = await DB.prepare(`
        SELECT * FROM products WHERE id = ?
      `).bind(order.product_id).first();
      
      if (product) {
        console.log('🎁 Product found:', { 
          title: product.title, 
          amountAe: product.amount_ae 
        });
        
        // Create FiveM redeem code
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
            
            console.log("🎉 SUCCESS! FiveM redeem code created in database:", {
              code: order_number,
              credits: creditsToGrant
            });
            
          } else {
            console.log('⚠️ FiveM database configuration not available');
          }
        } catch (dbError) {
          console.error('❌ Failed to create FiveM redeem code:', dbError);
        }
      }
      
      return c.json({ 
        received: true, 
        message: 'Payment processed successfully',
        order_number,
        status: 'paid'
      });
      
    } else {
      console.log('❌ Payment failed');
      
      // Update order status to failed
      await DB.prepare(`
        UPDATE orders 
        SET status = 'failed',
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(order.id).run();
      
      return c.json({ 
        received: true, 
        message: 'Payment failed',
        order_number,
        status: 'failed'
      });
    }
    
  } catch (error) {
    console.error('❌ Simple webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// GET /api/webhook/simple/test - Test endpoint
simpleWebhookRoutes.get('/simple/test', async (c) => {
  return c.json({ 
    message: 'Simple webhook endpoint is working',
    timestamp: new Date().toISOString()
  });
});
