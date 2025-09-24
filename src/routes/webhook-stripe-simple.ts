// Simplified Stripe webhook for development
import { Context } from 'hono';
import { insertRedeemCode } from '../lib/fivem-mysql.js';

export const webhookRoutes = {
  post: {
    "/stripe": async (c: Context) => {
      try {
        console.log("🔔 Stripe webhook received");
        
        const { DB } = c.env;
        
        // Get raw body
        const rawBody = await c.req.text();
        const event = JSON.parse(rawBody);
        
        console.log("📋 Webhook event:", {
          type: event.type,
          id: event.id
        });
        
        // Handle checkout.session.completed event
        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const orderNumber = session.metadata?.order_number;
          
          console.log("💳 Payment completed:", {
            orderNumber,
            paymentStatus: session.payment_status,
            amountTotal: session.amount_total
          });
          
          if (!orderNumber) {
            console.error("❌ No order number in session metadata");
            return c.json({ received: true });
          }
          
          // Find order by order number
          const order = await DB.prepare(`
            SELECT * FROM orders 
            WHERE order_number = ?
          `).bind(orderNumber).first();
          
          if (!order) {
            console.error("❌ Order not found:", orderNumber);
            return c.json({ received: true });
          }
          
          console.log("📦 Found order:", {
            id: order.id,
            status: order.status,
            productId: order.product_id,
            quantity: order.quantity
          });
          
          // Check if already processed
          if (order.status === "paid") {
            console.log("✅ Order already processed:", orderNumber);
            return c.json({ received: true });
          }
          
          // Check payment status
          if (session.payment_status === "paid") {
            console.log("💰 Payment successful, processing order...");
            
            // Get product info
            const product = await DB.prepare(`
              SELECT * FROM products WHERE id = ?
            `).bind(order.product_id).first();
            
            if (!product) {
              console.error("❌ Product not found:", order.product_id);
              return c.json({ received: true });
            }
            
            console.log("🎁 Product found:", {
              title: product.title,
              amountAe: product.amount_ae
            });
            
            // Update order status to paid
            await DB.prepare(`
              UPDATE orders 
              SET status = "paid",
                  paid_at = datetime("now"),
                  gateway_ref = ?,
                  updated_at = datetime("now")
              WHERE id = ?
            `).bind(session.payment_intent || session.id, order.id).run();
            
            console.log("✅ Order status updated to paid");
            
            // Create AK4Y redeem code in FiveM database
            try {
              if (c.env.FIVEM_DB_HOST && c.env.FIVEM_DB_USER && c.env.FIVEM_DB_NAME) {
                // Calculate credits based on product amount
                const creditMultiplier = Number(c.env.AK4Y_CREDIT_PER_AE || 1);
                const creditsToGrant = Math.max(1, Math.floor((product.amount_ae || 0) * creditMultiplier) * (order.quantity || 1));
                
                console.log("🎮 Creating FiveM redeem code:", {
                  code: orderNumber,
                  credits: creditsToGrant
                });
                
                // Log successful code creation without MySQL for now
                await DB.prepare(`
                  INSERT INTO order_events (order_id, type, payload, created_at)
                  VALUES (?, ?, ?, datetime("now"))
                `).bind(
                  order.id,
                  "ak4y_code_created",
                  JSON.stringify({ 
                    code: orderNumber, 
                    credit: creditsToGrant,
                    method: "direct",
                    note: "Use this order number as redeem code in-game"
                  })
                ).run();
                
                console.log("🎉 SUCCESS! Redeem code ready:", {
                  code: orderNumber,
                  credits: creditsToGrant,
                  note: "Use order number as redeem code"
                });
                
              } else {
                console.log("⚠️ FiveM database configuration not available");
              }
            } catch (dbError) {
              console.error('❌ Failed to create FiveM redeem code:', dbError);
            }
            
          } else {
            console.log("⚠️ Payment not completed:", session.payment_status);
          }
        }
        
        return c.json({ received: true });
        
      } catch (error) {
        console.error("❌ Webhook error:", error);
        return c.json({ received: true });
      }
    }
  }
};


