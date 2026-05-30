import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";

let cached: Redis | null = null;

export function redis(): Redis {
  if (cached) return cached;
  cached = new Redis({
    url: env.upstashRedisUrl(),
    token: env.upstashRedisToken(),
  });
  return cached;
}
