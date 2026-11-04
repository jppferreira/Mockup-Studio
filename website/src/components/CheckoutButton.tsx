import {
  checkoutCtaLabel,
  checkoutHref,
  isCheckoutConfigured,
  type PaidPlanId,
} from '@shared/checkout';

interface Props {
  plan: PaidPlanId;
  className?: string;
  children?: string;
}

export function CheckoutButton({ plan, className = 'btn btn-primary', children }: Props) {
  const href = checkoutHref(plan);
  const label = children ?? checkoutCtaLabel(plan);
  const configured = isCheckoutConfigured(plan);

  return (
    <a
      className={className}
      href={href}
      target={configured ? '_blank' : undefined}
      rel={configured ? 'noopener noreferrer' : undefined}
      data-checkout-plan={plan}
      data-checkout-ready={configured ? 'true' : 'false'}
    >
      {label}
    </a>
  );
}
