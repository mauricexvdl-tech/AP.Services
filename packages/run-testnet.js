/**
 * Direct runner for the testnet demo
 * Bypasses CLI framework to avoid TypeScript resolution issues
 */
var envPath = require("path").resolve(__dirname, "contracts", ".env");
console.log("Loading .env from:", envPath);
require("dotenv").config({ path: envPath });
console.log("ALCHEMY_API_KEY set:", !!process.env.ALCHEMY_API_KEY);
console.log("DEPLOYER_PRIVATE_KEY set:", !!process.env.DEPLOYER_PRIVATE_KEY);
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", esModuleInterop: true } });
require("./cli/src/commands/test-testnet").testTestnetCommand().catch(function (e) { console.error(e); process.exit(1); });
