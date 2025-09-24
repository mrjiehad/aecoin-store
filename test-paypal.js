// Test PayPal Integration
// This script tests the PayPal payment flow

const testPayPalPayment = async () => {
  try {
    console.log('🧪 Testing PayPal payment integration...');
    
    // 1. Test checkout with PayPal
    const checkoutResponse = await fetch('http://localhost:5173/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test@example.com',
        items: [
          {
            product_id: 1,
            quantity: 1
          }
        ],
        terms_accepted: true,
        payment_method: 'paypal'
      })
    });
    
    const checkoutData = await checkoutResponse.json();
    console.log('📊 Checkout Response:', checkoutData);
    
    if (checkoutData.success) {
      console.log('✅ PayPal checkout session created successfully!');
      console.log('🔗 PayPal approval URL:', checkoutData.data.payment_url);
      console.log('📝 Order Number:', checkoutData.data.order_number);
      console.log('💰 Total:', checkoutData.data.total);
      console.log('🏷️ Gateway:', checkoutData.data.gateway);
      
      // 2. Test webhook simulation
      console.log('\n🔔 Testing PayPal webhook...');
      
      const webhookResponse = await fetch('http://localhost:5173/api/webhook/paypal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'WH-TEST-' + Date.now(),
          event_type: 'CHECKOUT.ORDER.APPROVED',
          resource: {
            id: checkoutData.data.paypal_order_id || 'PAYPAL-ORDER-123',
            status: 'APPROVED',
            purchase_units: [
              {
                reference_id: checkoutData.data.order_number,
                custom_id: checkoutData.data.order_number
              }
            ]
          }
        })
      });
      
      const webhookData = await webhookResponse.json();
      console.log('📊 Webhook Response:', webhookData);
      
      if (webhookData.received) {
        console.log('✅ PayPal webhook processed successfully!');
      } else {
        console.log('❌ PayPal webhook failed');
      }
      
    } else {
      console.log('❌ PayPal checkout failed:', checkoutData.error);
      
      if (checkoutData.error.includes('not available') || checkoutData.error.includes('not configured')) {
        console.log('\n💡 To enable PayPal:');
        console.log('1. Sign up at: https://developer.paypal.com');
        console.log('2. Create a new app in PayPal Developer Dashboard');
        console.log('3. Get Client ID and Client Secret');
        console.log('4. Add to .dev.vars:');
        console.log('   PAYPAL_CLIENT_ID=your_client_id_here');
        console.log('   PAYPAL_CLIENT_SECRET=your_client_secret_here');
        console.log('   PAYPAL_SANDBOX=true');
        console.log('5. Restart the server: npm run dev');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure your server is running:');
    console.log('   npm run dev');
  }
};

// Run the test
testPayPalPayment();