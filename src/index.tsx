import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';
import { CloudflareBindings } from './types';
import { productRoutes } from './routes/products';
import { cartRoutes } from './routes/cart';
import { checkoutRoutes } from './routes/checkout';
import { webhookRoutes } from './routes/webhook';
import { simpleWebhookRoutes } from './routes/webhook-simple';
import { orderRoutes } from './routes/orders';
import { adminRoutes } from './routes/admin';
import { renderHomePage } from './components/home';

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Enable CORS for API routes
app.use('/api/*', cors());

// Disable rate limiting for development
app.use('/api/*', async (c, next) => {
  // Add headers to prevent rate limiting
  c.header('X-RateLimit-Bypass', 'true');
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  await next();
});

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }));

// API Routes
app.route('/api/products', productRoutes);
app.route('/api/cart', cartRoutes);
app.route('/api/checkout', checkoutRoutes);
app.route('/api/webhook', webhookRoutes);
app.route('/api/webhook', simpleWebhookRoutes);
app.route('/api/orders', orderRoutes);
app.route('/api/admin', adminRoutes);

// Test payment page route
app.get('/test-payment', async (c) => {
  const orderNumber = c.req.query('order') || '';
  const amount = c.req.query('amount') || '0';
  
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Payment - AECOIN Store</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        body { 
            background-color: #0D0D0D; 
            color: white;
        }
    </style>
</head>
<body>
    <div class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-[#1A1A1A] rounded-lg p-8 max-w-md w-full">
            <div class="text-center mb-6">
                <div class="text-yellow-400 text-6xl mb-4">
                    <i class="fas fa-flask"></i>
                </div>
                <h1 class="text-2xl font-bold mb-2">Test Payment Gateway</h1>
                <p class="text-gray-400">Simulate payment for testing</p>
            </div>
            
            <div class="bg-[#0D0D0D] rounded-lg p-4 mb-6">
                <p class="text-sm text-gray-400 mb-2">Order Number:</p>
                <p class="font-bold">${orderNumber}</p>
                
                <p class="text-sm text-gray-400 mb-2 mt-4">Amount:</p>
                <p class="text-2xl font-bold text-[#FFD600]">RM ${amount}</p>
            </div>
            
            <div class="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4 mb-6">
                <p class="text-yellow-400 text-sm">
                    <i class="fas fa-info-circle mr-2"></i>
                    This is TEST MODE. No real payment will be processed.
                </p>
            </div>
            
            <div class="space-y-3">
                <button onclick="simulateSuccess()" class="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold transition">
                    <i class="fas fa-check mr-2"></i>
                    Simulate Successful Payment
                </button>
                
                <button onclick="simulateFail()" class="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-bold transition">
                    <i class="fas fa-times mr-2"></i>
                    Simulate Failed Payment
                </button>
                
                <a href="/" class="block w-full bg-gray-700 hover:bg-gray-600 text-white text-center py-3 rounded-lg font-bold transition">
                    <i class="fas fa-arrow-left mr-2"></i>
                    Cancel
                </a>
            </div>
        </div>
        
        <div class="mt-6 text-center text-gray-500 text-sm">
            <p>To use real payment gateways:</p>
            <p>1. Sign up for Billplz or ToyyibPay</p>
            <p>2. Add API credentials to .dev.vars</p>
            <p>3. Restart the application</p>
        </div>
    </div>
    
    <script>
        async function simulateSuccess() {
            // Call test webhook to mark order as paid
            try {
                const response = await fetch('/api/webhook/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        order_number: '${orderNumber}',
                        status: 'success',
                        test: true
                    })
                });
                
                if (response.ok) {
                    alert('Payment simulated successfully!');
                    window.location.href = '/success?order=${orderNumber}&test=true';
                }
            } catch (error) {
                alert('Error simulating payment');
            }
        }
        
        function simulateFail() {
            alert('Payment failed (simulated)');
            window.location.href = '/checkout?error=payment_failed';
        }
    </script>
</body>
</html>
  `);
});

// Success page route
app.get('/success', (c) => {
  const orderNumber = c.req.query('order') || '';
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Successful - AECOIN Store</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <style>
        body { 
            background-color: #0D0D0D; 
            color: white;
        }
    </style>
</head>
<body>
    <div class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-[#1A1A1A] rounded-lg p-8 max-w-md w-full text-center">
            <div class="text-green-500 text-6xl mb-4 animate-bounce">
                <i class="fas fa-check-circle"></i>
            </div>
            <h1 class="text-3xl font-bold mb-4">Payment Successful!</h1>
            <p class="text-gray-400 mb-6">Thank you for your purchase. Your payment has been processed successfully.</p>
            
            <div class="bg-[#0D0D0D] rounded-lg p-4 mb-6 text-left">
                <p class="text-sm text-gray-400 mb-2">Order Number (Redeem Code):</p>
                <p class="font-mono text-[#FFD600] font-bold text-lg">${orderNumber}</p>

                <div class="mt-4 pt-4 border-t border-gray-700">
                  <h3 class="text-white font-semibold mb-2">How to redeem in-game (AK4Y)</h3>
                  <ol class="list-decimal list-inside text-sm text-gray-300 space-y-1">
                    <li>Join the server and log in to your character.</li>
                    <li>Type <span class="font-mono bg-gray-800 px-1 py-0.5 rounded">/donate</span> to open the donate UI.</li>
                    <li>Open the Redeem Code section.</li>
                    <li>Paste this code: <span class="font-mono text-[#FFD600]">${orderNumber}</span> and confirm.</li>
                    <li>Your credits will be added instantly based on your package.</li>
                  </ol>
                  <p class="text-xs text-gray-500 mt-3">Tip: Keep this code private; it can be used once.</p>
                </div>
            </div>
            
            <div class="space-y-3">
                <a href="/orders" class="block w-full bg-[#FFD600] text-black py-3 rounded-lg font-bold hover:bg-yellow-400 transition">
                    <i class="fas fa-receipt mr-2"></i>
                    View My Orders
                </a>
                <a href="/" class="block w-full bg-gray-700 text-white py-3 rounded-lg font-bold hover:bg-gray-600 transition">
                    <i class="fas fa-home mr-2"></i>
                    Continue Shopping
                </a>
            </div>
            
            <div class="mt-6 text-xs text-gray-500">
                <p>Powered by <i class="fab fa-stripe text-purple-400"></i> Stripe</p>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

// Page Routes
app.get('/', renderHomePage);

app.get('/packages', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AECOIN Packages - GTA Online Currency</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="/static/css/style.css" rel="stylesheet">
</head>
<body class="bg-[#0D0D0D] text-white">
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="/static/js/packages.js"></script>
</body>
</html>
  `);
});

app.get('/cart', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shopping Cart - AECOIN Store</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="/static/css/style.css" rel="stylesheet">
</head>
<body class="bg-[#0D0D0D] text-white">
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="/static/js/cart.js"></script>
</body>
</html>
  `);
});

app.get('/checkout', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Checkout - AECOIN Store</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="/static/css/style.css" rel="stylesheet">
</head>
<body class="bg-[#0D0D0D] text-white">
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="/static/js/checkout.js?v=${Date.now()}"></script>
    <!-- Payment selector disabled in test mode -->
    <!-- <script src="/static/js/payment-selector.js"></script> -->
</body>
</html>
  `);
});

app.get('/orders', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Orders - AECOIN Store</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="/static/css/style.css" rel="stylesheet">
</head>
<body class="bg-[#0D0D0D] text-white">
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="/static/js/orders.js"></script>
</body>
</html>
  `);
});

// Remove duplicate minimal success page and reuse the detailed one above
app.get('/success', async (c) => {
  const orderNumber = c.req.query('order') || '';
  const { DB } = c.env;
  
  let orderStatus = 'unknown';
  let orderData = null;
  
  if (orderNumber) {
    try {
      // Get order status from database
      const order = await DB.prepare(`
        SELECT o.*, p.title as product_title, p.amount_ae
        FROM orders o
        LEFT JOIN products p ON o.product_id = p.id
        WHERE o.order_number = ?
      `).bind(orderNumber).first();
      
      if (order) {
        orderStatus = order.status;
        orderData = order;
      }
    } catch (error) {
      console.error('Error fetching order status:', error);
    }
  }
  
  // Determine the content based on order status
  let pageTitle, iconClass, statusText, statusMessage, buttonColor, buttonText, buttonHref;
  
  switch (orderStatus) {
    case 'paid':
      pageTitle = 'Payment Successful!';
      iconClass = 'fas fa-check-circle text-green-500';
      statusText = 'Payment Successful!';
      statusMessage = 'Thank you for your purchase. Your payment has been processed successfully.';
      buttonColor = 'bg-[#FFD600] text-black hover:bg-yellow-400';
      buttonText = 'View My Orders';
      buttonHref = '/orders';
      break;
    case 'pending':
      pageTitle = 'Payment Pending';
      iconClass = 'fas fa-clock text-yellow-500';
      statusText = 'Payment Pending';
      statusMessage = 'Your payment is being processed. Please check back in a few minutes or check your email for updates.';
      buttonColor = 'bg-yellow-600 text-white hover:bg-yellow-700';
      buttonText = 'Check Order Status';
      buttonHref = '/orders';
      break;
    case 'failed':
    case 'cancelled':
      pageTitle = 'Payment Cancelled';
      iconClass = 'fas fa-times-circle text-red-500';
      statusText = 'Payment Cancelled';
      statusMessage = 'Your payment was cancelled or failed. No charges have been made to your account.';
      buttonColor = 'bg-red-600 text-white hover:bg-red-700';
      buttonText = 'Try Again';
      buttonHref = '/checkout';
      break;
    default:
      pageTitle = 'Order Status Unknown';
      iconClass = 'fas fa-question-circle text-gray-500';
      statusText = 'Order Status Unknown';
      statusMessage = 'We could not determine the status of your order. Please contact support if you need assistance.';
      buttonColor = 'bg-gray-600 text-white hover:bg-gray-700';
      buttonText = 'Contact Support';
      buttonHref = '/contact';
  }
  
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle} - AECOIN Store</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="/static/css/style.css" rel="stylesheet">
</head>
<body class="bg-[#0D0D0D] text-white">
    <div class="min-h-screen flex items-center justify-center p-4">
        <div class="bg-[#1A1A1A] rounded-lg p-8 max-w-md w-full text-center">
            <div class="text-6xl mb-4">
                <i class="${iconClass}"></i>
            </div>
            <h1 class="text-3xl font-bold mb-4">${statusText}</h1>
            <p class="text-gray-400 mb-6">${statusMessage}</p>
            
            ${orderNumber ? `
            <div class="bg-[#0D0D0D] rounded-lg p-4 mb-6 text-left">
                <p class="text-sm text-gray-400 mb-2">Order Number:</p>
                <p class="font-mono text-[#FFD600] font-bold text-lg">${orderNumber}</p>
                
                ${orderStatus === 'paid' ? `
                <div class="mt-4 pt-4 border-t border-gray-700">
                    <p class="text-sm text-gray-400 mb-2">
                        <i class="fas fa-envelope mr-2"></i>
                        Check your email for:
                    </p>
                    <ul class="text-sm text-white space-y-1 ml-6">
                        <li>• Payment confirmation</li>
                        <li>• AECOIN activation codes</li>
                        <li>• Order details</li>
                    </ul>
                    <div class="mt-4 pt-4 border-t border-gray-700">
                        <h3 class="text-white font-semibold mb-2">How to redeem (AK4Y)</h3>
                        <ol class="list-decimal list-inside text-sm text-gray-300 space-y-1">
                          <li>Join the server and log in to your character.</li>
                          <li>Type <span class="font-mono bg-gray-800 px-1 py-0.5 rounded">/donate</span>.</li>
                          <li>Open Redeem Code.</li>
                          <li>Paste your code and confirm.</li>
                        </ol>
                    </div>
                </div>
                ` : orderStatus === 'pending' ? `
                <div class="mt-4 pt-4 border-t border-gray-700">
                    <p class="text-sm text-gray-400">
                        <i class="fas fa-info-circle mr-2"></i>
                        Your order is pending payment confirmation.
                    </p>
                </div>
                ` : ''}
            </div>
            ` : ''}
            
            <div class="space-y-3">
                <a href="${buttonHref}" class="block w-full ${buttonColor} py-3 rounded-lg font-bold transition">
                    <i class="${orderStatus === 'paid' ? 'fas fa-receipt' : orderStatus === 'pending' ? 'fas fa-clock' : 'fas fa-redo'} mr-2"></i>
                    ${buttonText}
                </a>
                <a href="/" class="block w-full bg-gray-700 text-white py-3 rounded-lg font-bold hover:bg-gray-600 transition">
                    <i class="fas fa-home mr-2"></i>
                    Continue Shopping
                </a>
            </div>
            
            ${orderStatus === 'paid' ? `
            <div class="mt-6 text-xs text-gray-500">
                <p>Powered by <i class="fas fa-credit-card text-green-400"></i> ToyyibPay</p>
            </div>
            ` : ''}
        </div>
    </div>
</body>
</html>
  `);
});

// Admin panel
app.get('/admin', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel - AECOIN Store</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
    <link href="/static/css/style.css" rel="stylesheet">
</head>
<body class="bg-[#0D0D0D] text-white">
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
    <script src="/static/js/admin.js"></script>
</body>
</html>
  `);
});

export default app;