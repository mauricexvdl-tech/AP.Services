/**
 * APORIA Dummy Bot – Minimal Express server for testing the Resurrection Protocol
 *
 * Endpoints:
 *   GET /aporia-health  → 200 OK (Heartbeat check)
 *   GET /crash          → process.exit(1) (Simulates crash)
 *   GET /               → Bot info page
 */

const http = require("http");

const PORT = process.env.PORT || 3000;
let requestCount = 0;

const server = http.createServer((req, res) => {
    requestCount++;
    const timestamp = new Date().toISOString();

    if (req.url === "/aporia-health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            uptime: process.uptime(),
            requests: requestCount,
            timestamp,
        }));
        console.log(`[${timestamp}] ✅ Health check OK (#${requestCount})`);
        return;
    }

    if (req.url === "/crash" && req.method === "GET") {
        console.log(`[${timestamp}] 💀 CRASH endpoint hit! Shutting down...`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "crashing", message: "Goodbye cruel world!" }));

        // Exit after response is sent
        setTimeout(() => {
            console.log("☠️  Process exiting with code 1");
            process.exit(1);
        }, 100);
        return;
    }

    // Default info page
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
        name: "aporia-dummy-bot",
        version: "1.0.0",
        description: "Test bot for APORIA Resurrection Protocol",
        endpoints: {
            health: "GET /aporia-health",
            crash: "GET /crash",
        },
        env: {
            PORT,
            NODE_ENV: process.env.NODE_ENV || "development",
            API_KEY: process.env.API_KEY ? "[REDACTED]" : "not set",
        },
        uptime: process.uptime(),
        timestamp,
    }));
});

server.listen(PORT, () => {
    console.log(`\n🤖 APORIA Dummy Bot running on port ${PORT}`);
    console.log(`   Health:  http://localhost:${PORT}/aporia-health`);
    console.log(`   Crash:   http://localhost:${PORT}/crash`);
    console.log(`   Info:    http://localhost:${PORT}/\n`);
});
