# MGPay Test Application

This is a fully-functional test application for validating MGPay integrations in a production-like environment. The app simulates a complete payment flow, including webhook handling from MGPay.

## Features

- Create test orders with specified amounts
- Simulate payment flows with Paystack (Flutterwave coming soon)
- Receive and process webhooks from MGPay
- Test webhook reception manually
- View order history and status updates

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   cd test-app
   npm install
   ```
3. Configure environment variables:
   ```
   cp .env.example .env
   ```
   Edit the `.env` file to set:
   - `SERVICE_TOKEN`: Should match what's configured in MGPay
   - `PAYSTACK_PUBLIC_KEY`: Your Paystack public key
   - `PAYSTACK_SECRET_KEY`: Your Paystack secret key

4. Run the application:
   ```
   npm start
   ```
   The app will run on http://localhost:3000 by default.

## Deployment

To deploy this test app to a public server:

1. Push the code to your hosting environment
2. Set up your environment variables
3. Register your service with the MGPay team
4. Provide your webhook URL: `https://your-domain.com/webhook`
5. Configure firewall to allow incoming traffic from MGPay servers

## Testing the Integration

1. Create a test order through the web interface
2. Initiate a payment through the simulated payment flow
3. In a real environment, the payment provider would send a webhook to MGPay
4. MGPay would validate the webhook and forward it to your application
5. Use the "Test Webhook" feature to simulate receiving a webhook from MGPay

## Important Notes

- This is a test application and should not be used for processing real payments
- The SERVICE_TOKEN must match the token registered with MGPay
- In production, ensure your webhook endpoint is accessible from MGPay servers
- All webhook events and order statuses are logged for debugging purposes

## Troubleshooting

- Webhook not received: Check firewall settings and SERVICE_TOKEN configuration
- Order status not updated: Check webhook payload format and error logs
- Payment simulation fails: Ensure the test app is properly configured

For additional help, contact the MGPay team: platform@mediageneral.digital