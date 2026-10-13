export function demoPassword(): string {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error('SEED_DEMO_PASSWORD is required');
  return password;
}
