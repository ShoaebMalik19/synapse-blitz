// Deterministic test env (set before src/server/env.ts parses process.env; dotenv never overrides these).
process.env.DATABASE_URL = ":memory:";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.OPERATOR_ACCESS_TOKEN = "test-token";
process.env.X402_PAY_TO = "0x6cCC8A2fB675ecf7b4324e334773b95843818787";
process.env.X402_NETWORK_ID = "eip155:10143";
process.env.X402_ASSET_ADDRESS = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
process.env.X402_SERVICE_URL = "http://localhost:4021";
process.env.MONAD_CHAIN_ID = "10143";
process.env.LLM_API_KEY = "";
process.env.DEMO_STEP_DELAY_MS = "0";
process.env.LEASE_MS = "8000";
process.env.MONAD_ESCROW_ADDRESS = "";
