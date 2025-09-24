import crypto from 'crypto';

export interface CreateToyyibPayBillParams {
  orderNumber: string;
  amount: number; // in cents
  currency: string;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string; // Optional phone number
  returnUrl: string;
  callbackUrl: string;
}

export interface ToyyibPayBillResponse {
  success: boolean;
  data?: {
    billCode: string;
    billPaymentUrl: string;
  };
  error?: string;
}

export interface ToyyibPayWebhookData {
  refno: string;
  status: string;
  reason: string;
  billcode: string;
  order_id: string;
  amount: string;
  signature: string;
}

export class ToyyibPayGateway {
  private secretKey: string;
  private categoryCode: string;
  private baseUrl: string;

  constructor(secretKey: string, categoryCode: string = 'mmsixvz8') {
    this.secretKey = secretKey;
    this.categoryCode = categoryCode;
    this.baseUrl = 'https://toyyibpay.com'; // Use production environment
  }

  /**
   * Create a bill for payment
   */
  async createBill(params: CreateToyyibPayBillParams): Promise<ToyyibPayBillResponse> {
    try {
      // Amount should be in sen (cents) - ToyyibPay expects integer in sen
      const amountInSen = Math.round(params.amount * 100);

      const billData = {
        userSecretKey: this.secretKey,
        categoryCode: this.categoryCode,
        billName: params.description.substring(0, 30), // Limit to 30 characters
        billDescription: params.description,
        billPriceSetting: '1', // Fixed price
        billPayorInfo: '1', // Collect payer info
        billAmount: amountInSen.toString(),
        billReturnUrl: params.returnUrl,
        billCallbackUrl: params.callbackUrl,
        billExternalReferenceNo: params.orderNumber,
        billTo: params.customerName.substring(0, 30), // Limit customer name too
        billEmail: params.customerEmail,
        billPhone: params.customerPhone || '0123456789', // Use provided phone or default
        billSplitPayment: '0',
        billSplitPaymentArgs: '',
        billPaymentChannel: '0', // All channels
        billContentEmail: `Payment for ${params.description}`,
        billChargeToCustomer: '1'
      };

      console.log('Creating ToyyibPay bill with data:', JSON.stringify(billData, null, 2));

      const response = await fetch(`${this.baseUrl}/index.php/api/createBill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(billData).toString()
      });

      const responseText = await response.text();
      console.log('ToyyibPay API response:', responseText);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${responseText}`
        };
      }

      // ToyyibPay returns an array with bill details or an error string
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        // Handle non-JSON responses like [KEY-DID-NOT-EXIST-OR-USER-IS-NOT-ACTIVE]
        if (responseText.includes('KEY-DID-NOT-EXIST') || responseText.includes('USER-IS-NOT-ACTIVE')) {
          return {
            success: false,
            error: 'Invalid ToyyibPay credentials or inactive account. Please check your secret key and category code.'
          };
        }
        return {
          success: false,
          error: `Failed to parse response: ${responseText}`
        };
      }

      if (Array.isArray(responseData) && responseData.length > 0) {
        const billInfo = responseData[0];
        if (billInfo.BillCode) {
          return {
            success: true,
            data: {
              billCode: billInfo.BillCode,
              billPaymentUrl: `${this.baseUrl}/${billInfo.BillCode}`
            }
          };
        } else {
          return {
            success: false,
            error: billInfo.error || 'Unknown error creating bill'
          };
        }
      } else if (responseData && responseData.status === 'error') {
        // Handle error response format
        return {
          success: false,
          error: responseData.msg || 'ToyyibPay API error'
        };
      } else {
        return {
          success: false,
          error: 'Invalid response format from ToyyibPay'
        };
      }

    } catch (error) {
      console.error('ToyyibPay createBill error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get bill transactions/status
   */
  async getBillTransactions(billCode: string) {
    try {
      const response = await fetch(`${this.baseUrl}/index.php/api/getBillTransactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          userSecretKey: this.secretKey,
          billCode: billCode
        }).toString()
      });

      const responseData = await response.json();
      return responseData;
    } catch (error) {
      console.error('ToyyibPay getBillTransactions error:', error);
      return null;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(data: ToyyibPayWebhookData): boolean {
    try {
      // ToyyibPay signature format: MD5(refno + billcode + status + amount + order_id + secretkey)
      const signatureString = `${data.refno}${data.billcode}${data.status}${data.amount}${data.order_id}${this.secretKey}`;
      const expectedSignature = crypto.createHash('md5').update(signatureString).digest('hex');
      
      console.log('ToyyibPay signature verification:');
      console.log('Signature string:', signatureString);
      console.log('Expected signature:', expectedSignature);
      console.log('Received signature:', data.signature);
      
      return expectedSignature.toLowerCase() === data.signature.toLowerCase();
    } catch (error) {
      console.error('ToyyibPay signature verification error:', error);
      return false;
    }
  }

  /**
   * Check if payment is successful
   */
  isPaymentSuccessful(status: string): boolean {
    // ToyyibPay status codes:
    // 1 = Successful payment
    // 2 = Pending payment
    // 3 = Failed payment
    return status === '1';
  }

  /**
   * Get available categories for this user
   */
  async getCategories() {
    try {
      const response = await fetch(`${this.baseUrl}/index.php/api/getCategoryDetails`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          userSecretKey: this.secretKey
        }).toString()
      });

      const responseText = await response.text();
      console.log('ToyyibPay Categories response:', responseText);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${responseText}`
        };
      }

      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        if (responseText.includes('KEY-DID-NOT-EXIST') || responseText.includes('USER-IS-NOT-ACTIVE')) {
          return {
            success: false,
            error: 'Invalid ToyyibPay credentials or inactive account.'
          };
        }
        return {
          success: false,
          error: `Failed to parse response: ${responseText}`
        };
      }

      return {
        success: true,
        data: responseData
      };

    } catch (error) {
      console.error('ToyyibPay getCategories error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}