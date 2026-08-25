type TossSdkPaymentMethod = { code: string; methodId?: string };

type TossSdkPaymentWindow = {
  on(
    event: "paymentRequest",
    callback: (paymentMethod: TossSdkPaymentMethod) => void,
  ): void;
  on(event: "cancel", callback: () => void): void;
  destroy: () => Promise<void> | void;
};

type TossSdkWidgets = {
  setAmount: (input: { currency: "KRW"; value: number }) => Promise<void>;
  renderPaymentWindow: () => Promise<TossSdkPaymentWindow>;
  requestPayment: (input: {
    paymentMethod: TossSdkPaymentMethod;
    orderId: string;
    orderName: string;
    successUrl: string;
    failUrl: string;
    customerName: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
  }) => Promise<void>;
};

interface Window {
  TossPayments?: (clientKey: string) => {
    payment: (input: { customerKey: string }) => {
      requestBillingAuth: (input: {
        method: "CARD";
        successUrl: string;
        failUrl: string;
        customerName: string;
      }) => Promise<void>;
    };
    widgets: (input: { customerKey: "ANONYMOUS" }) => TossSdkWidgets;
  };
}
