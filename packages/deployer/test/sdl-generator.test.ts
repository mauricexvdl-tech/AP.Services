import { describe, it, expect } from "vitest";
import { generateSDL, SDLConfig } from "../src/sdl-generator";
import { Tier, TIER_SPECS, validatePorts, ALLOWED_PORTS } from "../src/tiers";
import * as yaml from "js-yaml";

describe("SDL Generator", () => {
    // ─── Basic Generation ──────────────────────────────────────

    describe("Basic SDL Generation", () => {
        it("should generate valid YAML for NANO tier", () => {
            const config: SDLConfig = {
                imageURI: "docker.io/mybot:latest",
                tier: Tier.NANO,
                ports: [3000],
            };

            const result = generateSDL(config);

            expect(result.sdl).toBeTruthy();
            expect(result.tierSpec).toEqual(TIER_SPECS[Tier.NANO]);

            // Should be valid YAML
            const parsed = yaml.load(result.sdl) as any;
            expect(parsed.version).toBe("2.0");
            expect(parsed.services["aporia-bot"].image).toBe("docker.io/mybot:latest");
        });

        it("should generate correct resources for LOGIC tier", () => {
            const config: SDLConfig = {
                imageURI: "myapi:v2",
                tier: Tier.LOGIC,
                ports: [80, 443],
            };

            const result = generateSDL(config);
            const resources = result.sdlObject.profiles.compute["aporia-bot"].resources;

            expect(resources.cpu.units).toBe(2);
            expect(resources.memory.size).toBe("4Gi");
        });

        it("should generate correct resources for EXPERT tier", () => {
            const config: SDLConfig = {
                imageURI: "databot:latest",
                tier: Tier.EXPERT,
                ports: [3000],
            };

            const result = generateSDL(config);
            const resources = result.sdlObject.profiles.compute["aporia-bot"].resources;

            expect(resources.cpu.units).toBe(4);
            expect(resources.memory.size).toBe("8Gi");
        });
    });

    // ─── Custom Configuration ─────────────────────────────────

    describe("Custom Configuration", () => {
        it("should use custom deployment name", () => {
            const config: SDLConfig = {
                imageURI: "mybot:latest",
                tier: Tier.NANO,
                ports: [3000],
                name: "my-trading-bot",
            };

            const result = generateSDL(config);
            expect(result.sdlObject.services["my-trading-bot"]).toBeTruthy();
        });

        it("should include environment variables", () => {
            const config: SDLConfig = {
                imageURI: "mybot:latest",
                tier: Tier.NANO,
                ports: [3000],
                envVars: { NODE_ENV: "production", PORT: "3000" },
            };

            const result = generateSDL(config);
            const env = result.sdlObject.services["aporia-bot"].env;
            expect(env).toContain("NODE_ENV=production");
            expect(env).toContain("PORT=3000");
        });
    });

    // ─── Port Exposure ─────────────────────────────────────────

    describe("Port Exposure", () => {
        it("should expose multiple ports", () => {
            const config: SDLConfig = {
                imageURI: "mybot:latest",
                tier: Tier.NANO,
                ports: [80, 443, 3000],
            };

            const result = generateSDL(config);
            const expose = result.sdlObject.services["aporia-bot"].expose;
            expect(expose).toHaveLength(3);
            expect(expose.map((e: any) => e.port)).toEqual([80, 443, 3000]);
        });

        it("should reject invalid ports", () => {
            const config: SDLConfig = {
                imageURI: "mybot:latest",
                tier: Tier.NANO,
                ports: [8080], // not in allowed list
            };

            expect(() => generateSDL(config)).toThrow("Invalid ports");
        });

        it("should reject mixed valid/invalid ports", () => {
            const config: SDLConfig = {
                imageURI: "mybot:latest",
                tier: Tier.NANO,
                ports: [80, 9999],
            };

            expect(() => generateSDL(config)).toThrow("9999");
        });
    });
});

// ─── Tier Validation ─────────────────────────────────────────

describe("Tier Validation", () => {
    it("should have 3 tiers defined", () => {
        expect(Object.keys(TIER_SPECS)).toHaveLength(3);
    });

    it("should validate allowed ports", () => {
        expect(validatePorts([80, 443, 3000]).valid).toBe(true);
        expect(validatePorts([8080]).valid).toBe(false);
        expect(validatePorts([80, 8080]).valid).toBe(false);
        expect(validatePorts([80, 8080]).invalidPorts).toEqual([8080]);
    });

    it("should have correct specs for each tier", () => {
        expect(TIER_SPECS[Tier.NANO].cpu).toBe(1);
        expect(TIER_SPECS[Tier.NANO].memoryMB).toBe(1024);

        expect(TIER_SPECS[Tier.LOGIC].cpu).toBe(2);
        expect(TIER_SPECS[Tier.LOGIC].memoryMB).toBe(4096);

        expect(TIER_SPECS[Tier.EXPERT].cpu).toBe(4);
        expect(TIER_SPECS[Tier.EXPERT].memoryMB).toBe(8192);
    });
});
