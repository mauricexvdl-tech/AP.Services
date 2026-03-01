import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        testTimeout: 15000,
    },
    resolve: {
        alias: {
            "@aporia/heartbeat": path.resolve(__dirname, "../heartbeat/src/index.ts"),
            "@aporia/secrets": path.resolve(__dirname, "../secrets/src/index.ts"),
            "@aporia/deployer": path.resolve(__dirname, "../deployer/src/index.ts"),
            "@aporia/gateway": path.resolve(__dirname, "../gateway/src/index.ts"),
        },
    },
});
