export type PaddlePeriod = { starts_at: string; ends_at: string };
export type PaddleSubscription = {
  id: string;
  customer_id: string;
  status: string;
  updated_at: string;
  current_billing_period: PaddlePeriod | null;
  next_billed_at: string | null;
  scheduled_change: { action: string; effective_at: string } | null;
  custom_data?: {easycut_change_canceled?:string;easycut_change_id?:string;easycut_checkout_id?:string}|null;
  items: { price: { id: string }; quantity: number }[];
};
export type PaddleTransaction = {
  id: string;
  status: string;
  customer_id: string | null;
  subscription_id: string | null;
  discount_id: string | null;
  origin?: string;
  currency_code: string;
  billing_period: PaddlePeriod | null;
  custom_data: { easycut_checkout_id?: string; easycut_change_id?: string } | null;
  items: {
    price: {
      id: string;
      unit_price: { amount: string; currency_code: string };
      tax_mode: string;
      billing_cycle: { interval: string; frequency: number } | null;
    };
    quantity: number;
    proration: { rate: string; billing_period?: PaddlePeriod } | null;
  }[];
  details: {
    totals: { total: string; subtotal: string; tax: string; discount: string };
    line_items: { totals: { total: string } }[];
  };
};
export type PaddleAdjustment = {
  id: string;
  transaction_id: string;
  status: string;
  action: string;
  updated_at: string;
  totals: { total: string; subtotal: string };
};
