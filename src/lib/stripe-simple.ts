// Simple Stripe Integration
import type { CloudflareBindings } from '../types';

export interface StripeLineItem {
  name: string;
  description?: string;
  amount: number; // in cents
  quantity: number;
}

export interface CreateCheckoutParams {
  orderNumber: string;
  email: string;
  items: StripeLineItem[];
  successUrl: string;
  cancelUrl: string;
}

export async function createStripeCheckoutSession(
  env: CloudflareBindings, 
  params: CreateCheckoutParams
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    console.log('🔵 Creating Stripe checkout session...');
    
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_SECRET_KEY.startsWith('sk_')) {
      throw new Error('Invalid Stripe secret key');
    }
    
    // Prepare line items for Stripe
    const lineItems = params.items.map((item, index) => ({
      [`line_items[${index}][price_data][currency]`]: 'myr',
      [`line_items[${index}][price_data][product_data][name]`]: item.name,
      [`line_items[${index}][price_data][product_data][description]`]: item.description || '',
      [`line_items[${index}][price_data][unit_amount]`]: item.amount.toString(),
      [`line_items[${index}][quantity]`]: item.quantity.toString(),
    }));
    
    // Flatten line items into form data
    const formData = new URLSearchParams();
    lineItems.forEach(item => {
      Object.entries(item).forEach(([key, value]) => {
        formData.append(key, value);
      });
    });
    
    // Add other parameters
    formData.append('mode', 'payment');
    formData.append('success_url', params.successUrl);
    formData.append('cancel_url', params.cancelUrl);
    formData.append('customer_email', params.email);
    formData.append('metadata[order_number]', params.orderNumber);
    formData.append('payment_method_types[]', 'card');
    
    console.log('🔵 Making Stripe API request...');
    
    // Make request to Stripe
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });
    
    const responseText = await response.text();
    console.log('🔵 Stripe response status:', response.status);
    console.log('🔵 Stripe response:', responseText.substring(0, 200) + '...');
    
    if (!response.ok) {
      console.error('❌ Stripe API error:', responseText);
      return {
        success: false,
        error: `Stripe API error: ${response.status}`
      };
    }
    
    const session = JSON.parse(responseText);
    
    console.log('✅ Stripe session created:', {
      id: session.id,
      url: session.url?.substring(0, 50) + '...',
      amount: session.amount_total,
      currency: session.currency
    });
    
    return {
      success: true,
      data: {
        session_id: session.id,
        payment_url: session.url,
        amount_total: session.amount_total,
        currency: session.currency
      }
    };
    
  } catch (error) {
    console.error('❌ Stripe integration error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown Stripe error'
    };
  }
}
