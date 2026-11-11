-- Pro licenses get 1 Mac seat; Pro Max keeps 2.
-- Aligns existing rows with defaultMaxDevicesForTier / Stripe + key grant paths.

update public.mokstudio_entitlements
set max_devices = 1
where tier = 'pro'
  and max_devices > 1;

update public.mokstudio_entitlements
set max_devices = 2
where tier = 'pro_max'
  and max_devices < 2;
