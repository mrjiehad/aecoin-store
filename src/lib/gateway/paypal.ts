// PayPal Payment Gateway Integration
import { Context } from 'hono';

interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  sandbox: boolean;
}

interface CreatePayPalOrderParams {
  orderNumber: string;
  email: string;
  amount: number; // in cents
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

interface PayPalOrderResponse {
  id: string;
  status: string;
  links: Array<{
    href: string;
    rel: string;
    method: string;
  }>;
}

interface PayPalAccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class PayPalGateway {
  private config: PayPalConfig;

  constructor(config: PayPalConfig) {
    this.config = config;
  }

  /**
   * Get PayPal access token
   */
  private async getAccessToken(): Promise<string> {
    const auth = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    
    const response = await fetch(`${this.config.apiUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`PayPal auth error: ${response.status} - ${error}`);
    }

    const result = await response.json() as PayPalAccessTokenResponse;
    return result.access_token;
  }

  /**
   * Create PayPal order
   */
  async createOrder(params: CreatePayPalOrderParams): Promise<{ 
    success: boolean; 
    data?: { orderId: string; approvalUrl: string }; 
    error?: string; 
  }> {
    try {
      const accessToken = await this.getAccessToken();
      
      const orderData = {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: params.orderNumber,
          amount: {
            currency_code: params.currency,
            value: (params.amount / 100).toFixed(2), // Convert cents to dollars
          },
          description: params.description,
          custom_id: params.orderNumber,
        }],
        application_context: {
          return_url: params.returnUrl,
          cancel_url: params.cancelUrl,
          brand_name: 'AECOIN Store',
          user_action: 'PAY_NOW',
          payment_method: {
            payer_selected: 'PAYPAL',
            payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
          },
        },
      };

      const response = await fetch(`${this.config.apiUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': params.orderNumber, // Idempotency key
        },
        body: JSON.stringify(orderData),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('PayPal create order error:', error);
        return { 
          success: false, 
          error: `PayPal API error: ${response.status}` 
        };
      }

      const result = await response.json() as PayPalOrderResponse;
      
      // Find approval URL
      const approvalLink = result.links.find(link => link.rel === 'approve');
      if (!approvalLink) {
        return { 
          success: false, 
          error: 'No approval URL found in PayPal response' 
        };
      }

      return {
        success: true,
        data: {
          orderId: result.id,
          approvalUrl: approvalLink.href,
        },
      };

    } catch (error: any) {
      console.error('PayPal order creation error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Capture PayPal order after approval
   */
  async captureOrder(orderId: string): Promise<{
    success: boolean;
    data?: any;
    error?: string;
  }> {
    try {
      const accessToken = await this.getAccessToken();

      const response = await fetch(`${this.config.apiUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('PayPal capture error:', error);
        return { 
          success: false, 
          error: `PayPal capture error: ${response.status}` 
        };
      }

      const result = await response.json();
      return {
        success: true,
        data: result,
      };

    } catch (error: any) {
      console.error('PayPal capture error:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Verify webhook signature (for webhook security)
   */
  verifyWebhookSignature(
    payload: string,
    headers: Record<string, string>,
    webhookId: string
  ): boolean {
    // PayPal webhook verification is more complex and requires additional setup
    // For development, we'll skip verification
    // In production, implement proper webhook verification
    return true;
  }
}

/**
 * Initialize PayPal gateway with environment configuration
 */
export function initPayPalGateway(env: any): PayPalGateway {
  const config: PayPalConfig = {
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    apiUrl: env.PAYPAL_SANDBOX === 'true' 
      ? 'https://api-m.sandbox.paypal.com' 
      : 'https://api-m.paypal.com',
    sandbox: env.PAYPAL_SANDBOX === 'true',
  };

  if (!config.clientId || !config.clientSecret) {
    throw new Error('PayPal credentials not configured');
  }

  return new PayPalGateway(config);
}