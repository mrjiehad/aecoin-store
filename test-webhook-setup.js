// Test script to verify webhook setup
import fetch from 'node-fetch';

const WEBHOOK_URL = 'http://localhost:3000/api/webhook/stripe';

// Sample Stripe webhook event for checkout.session.completed
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
        order_number: 'TEST123456789'
      }
    }
  }
};

async function testWebhook() {
  try {
    console.log('🧪 Testing Stripe webhook endpoint...');
    console.log('URL:', WEBHOOK_URL);
    console.log('Event type:', testEvent.type);
    console.log('');

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // No Stripe-Signature header to bypass signature verification
      },
      body: JSON.stringify(testEvent)
    });

    const responseText = await response.text();
    
    console.log('📊 Response Status:', response.status);
    console.log('📊 Response Body:', responseText);
    
    if (response.ok) {
      console.log('✅ Webhook endpoint is responding correctly!');
    } else {
      console.log('❌ Webhook endpoint returned an error');
    }
    
  } catch (error) {
    console.error('❌ Failed to test webhook:', error.message);
    console.log('');
    console.log('💡 Make sure your development server is running:');
    console.log('   npm run dev:sandbox');
  }
}

testWebhook();
