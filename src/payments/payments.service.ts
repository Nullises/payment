import { Inject } from '@nestjs/common';
import { NATS_SERVICE, envs } from 'src/config';
import Stripe from 'stripe';
import { PaymentSessionDto } from './dto/payments-session.dto';
import { Request, Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';


export class PaymentsService {
  private readonly stripe = new Stripe(envs.stripeSecretKey);

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  async createPaymentSession(paymentSessionDto: PaymentSessionDto) {
    const { currency, items, orderId } = paymentSessionDto;

    const lineItems = items.map((item) => {
      return {
        price_data: {
          currency: currency,
          product_data: {
            name: item.name,
          },
          unit_amount: Math.round(item.price * 100), //Ejemplo: 20$ == 2000 / 100 = 20
        },
        quantity: item.quantity,
      };
    });

    const session = await this.stripe.checkout.sessions.create({
      // OrderId
      payment_intent_data: {
        metadata: {
          orderId: orderId,
        },
      },
      line_items: lineItems,
      mode: 'payment',
      success_url: envs.stripeSuccessUrl,
      cancel_url: envs.stripeCancelUrl,
    });
    return {
      cancelUrl: session.cancel_url,
      successUrl: session.success_url,
      url: session.url
    }
  }

  async stripeWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'];

    let event: Stripe.Event;

    // testing
    //const endpointSecret =

    // Development
    const endpointSecret = envs.stripeEndpointSecret;

    try {
      event = this.stripe.webhooks.constructEvent(
        req['rawBody'],
        sig,
        endpointSecret,
      );
    } catch (err) {
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    if ((event.type = 'charge.succeeded')) {
      // Call Microservice (orders)
      //console.log(event.data);

      const chargeSucceeded = event.data.object;

      const payload = {
        stripePaymentId: chargeSucceeded['id'],
        orderId: chargeSucceeded['metadata'].orderId,
        receiptUrl: chargeSucceeded['receipt_url']
      };

      this.client.emit('payment.succeded', payload)
    }

    return res.status(200).json({
      received: true,
      sig,
    });
  }
}
