import type { CacheAdapter } from "@mikro-orm/core";
import IORedis from "ioredis";
import type { Redis, RedisOptions } from "ioredis";

export interface BaseOptions {
  expiration?: number;
  debug?: boolean;
}

export interface BuildOptions extends BaseOptions, RedisOptions {}
export interface ClientOptions extends BaseOptions {
  client: Redis;
  keyPrefix?: string;
}

export type RedisCacheAdapterOptions = BuildOptions | ClientOptions;

export class RedisCacheAdapter implements CacheAdapter {
  private readonly client: Redis;
  private readonly debug: boolean;
  private readonly expiration?: number;
  private readonly keyPrefix!: string;

  constructor(options: RedisCacheAdapterOptions) {
    const { debug = false, expiration, keyPrefix } = options;
    this.keyPrefix = keyPrefix || "mikro";
    if ((options as ClientOptions).client) {
      this.client = (options as ClientOptions).client;
    } else {
      const { ...redisOpt } = options as BuildOptions;
      this.client = new IORedis(redisOpt);
    }
    this.debug = debug;
    this.expiration = expiration;
    if (this.debug) {
      console.log(`redis client created!`, this.expiration);
    }
  }

  _getKey(name: string) {
    return `${this.keyPrefix}:${name}`;
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    const completKey = this._getKey(key);
    const data = await this.client.get(completKey);
    if (this.debug) {
      console.log(`get "${completKey}": "${data}"`);
    }
    if (!data) return undefined;
    return JSON.parse(data);
  }

  async set(
    key: string,
    data: any,
    origin: string,
    expiration = this.expiration
  ): Promise<void> {
    const stringData = JSON.stringify(data);
    const completKey = this._getKey(key);
    if (this.debug) {
      console.log(
        `set "${completKey}": "${stringData}" with expiration ${expiration}`
      );
    }
    if (expiration) {
      await this.client.set(completKey, stringData, "PX", expiration);
    } else {
      await this.client.set(completKey, stringData);
    }
  }

  async clear(): Promise<void> {
    if (this.debug) {
      console.log("clearing cache...");
    }
    return new Promise((resolve, reject) => {
      const stream = this.client.scanStream({
        match: `${this.keyPrefix}:*`,
      });
      const pipeline = this.client.pipeline();
      stream.on("data", (keys: string[]) => {
        if (keys.length) {
          keys.forEach(function (key) {
            pipeline.del(key);
          });
        }
      });
      stream.on("end", () => {
        pipeline.exec((err) => {
          if (err) {
            if (this.debug) {
              console.log("Error clearing cache");
            }
            return reject(err);
          }
          if (this.debug) {
            console.log("cleared cache");
          }
          resolve();
        });
      });
    });
  }

  async close() {
    this.client.disconnect();
  }
}
