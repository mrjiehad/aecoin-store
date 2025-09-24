// Simple webhook test that bypasses Stripe gateway
import fetch from 'node-fetch';

const WEBHOOK_URL = 'http://localhost:3000/api/webhook/stripe';

// Test with a real order number that exists in your database
const testEvent = {
  id: 'evt_test_webhook',
  object: 'event',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_123456789',
      object: 'checkout.session',
      payment_status: 'paid',
      amount_total: 10000, // $100.00 in cents
      currency: 'usd',
      customer_email: 'test@example.com',
      payment_intent: 'pi_test_123456789',
      metadata: {
        order_number: 'AEMFWGGG13NWWV1N' // Use your existing order number
      }
    }
  }
};

async function testSimpleWebhook() {
  try {
    console.log('🧪 Testing simple webhook (bypassing Stripe gateway)...');
    console.log('URL:', WEBHOOK_URL);
    console.log('Event type:', testEvent.type);
    console.log('Order number:', testEvent.data.object.metadata.order_number);
    console.log('');

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testEvent)
    });

    const responseText = await response.text();
    
    console.log('📊 Response Status:', response.status);
    console.log('📊 Response Body:', responseText);
    
    if (response.ok) {
      console.log('✅ Webhook processed successfully!');
      console.log('Check your server logs for "ak4y_code_created" events');
    } else {
      console.log('❌ Webhook returned an error');
    }
    
  } catch (error) {
    console.error('❌ Failed to test webhook:', error.message);
  }
}

testSimpleWebhook();


