import { DEFAULT_MAX_CACHE_SIZE, DEFAULT_MAX_EVENT_STREAM_RETRIES } from "./constants";

export type CacheOption = 'lru' | 'disabled';

export interface Config {

  /**
   * The domain name or IP address of flagd.
   *
   * @default localhost
   */
  host: string;

  /**
   * The port flagd is listen on.
   *
   * @default 8013
   */
  port: number;

  /**
   * Determines if TLS should be used.
   *
   * @default false
   */
  tls: boolean;

  /**
   * When set, a unix socket connection is used.
   *
   * @example "/tmp/flagd.socks"
   */
  socketPath?: string;

  /**
   * Cache implementation to use (or disabled).
   *
   * @default 'lru'
   */
  cache?: CacheOption;

  /**
   * Max cache size (items).
   *
   * @default 1000
   */
  maxCacheSize?: number;

  /**
   * Amount of times to attempt to reconnect to the event stream.
   *
   * @default 5
   */
  maxEventStreamRetries?: number;
}

export interface InProcessConfig {

  /**
   * The domain name or IP address of flagd.
   *
   * @default localhost
   */
  host: string;

  /**
   * The port flagd is listen on.
   *
   * @default 8013
   */
  port: number;

  /**
   * Determines if TLS should be used.
   *
   * @default false
   */
  tls: boolean;

  /**
   * When set, a unix socket connection is used.
   *
   * @example "/tmp/flagd.socks"
   */
  socketPath?: string;

  /**
   * Max cache size (items).
   *
   * @default 1000
   */
  maxCacheSize?: number;

  /**
   * Amount of times to attempt to reconnect to the event stream.
   *
   * @default 5
   */
  maxEventStreamRetries?: number;
  flagDSourceUri: string;
  flagDSourceProviderType: 'grpc' | 'kubernetes';
  flagDSourceSelector: string;
}

export type FlagdProviderOptions = Partial<Config>|Partial<InProcessConfig>;

const DEFAULT_CONFIG: Config = {
  host: 'localhost',
  port: 8013,
  tls: false,
  cache: 'lru',
  maxCacheSize: DEFAULT_MAX_CACHE_SIZE,
  maxEventStreamRetries: DEFAULT_MAX_EVENT_STREAM_RETRIES,
};

const DEFAULT_INPROCESS_CONFIG: InProcessConfig = {
  host: 'localhost',
  port: 8013,
  tls: false,
  maxCacheSize: DEFAULT_MAX_CACHE_SIZE,
  maxEventStreamRetries: DEFAULT_MAX_EVENT_STREAM_RETRIES,
  flagDSourceUri: '',
  flagDSourceProviderType: 'grpc',
  flagDSourceSelector: ''
};

enum ENV_VAR {
  FLAGD_HOST = 'FLAGD_HOST',
  FLAGD_PORT = 'FLAGD_PORT',
  FLAGD_TLS = 'FLAGD_TLS',
  FLAGD_SOCKET_PATH = 'FLAGD_SOCKET_PATH',
  FLAGD_CACHE = 'FLAGD_CACHE',
  FLAGD_MAX_CACHE_SIZE = 'FLAGD_MAX_CACHE_SIZE',
  FLAGD_MAX_EVENT_STREAM_RETRIES = 'FLAGD_MAX_EVENT_STREAM_RETRIES',
  FLAGD_SOURCE_URI = 'FLAGD_SOURCE_URI',
  FLAGD_SOURCE_PROVIDER_TYPE = 'FLAGD_SOURCE_PROVIDER_TYPE',
  FLAGD_SOURCE_SELECTOR = 'FLAGD_SOURCE_SELECTOR',
}

const getEnvVarConfig = (): Partial<Config | InProcessConfig> => ({
  ...(process.env[ENV_VAR.FLAGD_HOST] && {
    host: process.env[ENV_VAR.FLAGD_HOST],
  }),
  ...(Number(process.env[ENV_VAR.FLAGD_PORT]) && {
    port: Number(process.env[ENV_VAR.FLAGD_PORT]),
  }),
  ...(process.env[ENV_VAR.FLAGD_TLS] && {
    tls: process.env[ENV_VAR.FLAGD_TLS]?.toLowerCase() === 'true',
  }),
  ...(process.env[ENV_VAR.FLAGD_SOCKET_PATH] && {
    socketPath: process.env[ENV_VAR.FLAGD_SOCKET_PATH],
  }),
  ...((process.env[ENV_VAR.FLAGD_CACHE] === 'lru' || process.env[ENV_VAR.FLAGD_CACHE] === 'disabled') && {
    cache: process.env[ENV_VAR.FLAGD_CACHE],
  }),
  ...(process.env[ENV_VAR.FLAGD_MAX_CACHE_SIZE] && {
    maxCacheSize:  Number(process.env[ENV_VAR.FLAGD_MAX_CACHE_SIZE]),
  }),
  ...(process.env[ENV_VAR.FLAGD_MAX_EVENT_STREAM_RETRIES] && {
    maxEventStreamRetries: Number(process.env[ENV_VAR.FLAGD_MAX_EVENT_STREAM_RETRIES]),
  }),
  ...(process.env[ENV_VAR.FLAGD_SOURCE_URI] && {
    flagDSourceUri: process.env[ENV_VAR.FLAGD_SOURCE_URI],
  }),
  ...(process.env[ENV_VAR.FLAGD_SOURCE_PROVIDER_TYPE] && {
    flagDSourceProviderType: process.env[ENV_VAR.FLAGD_SOURCE_PROVIDER_TYPE],
  }),
  ...(process.env[ENV_VAR.FLAGD_SOURCE_SELECTOR] && {
    flagDSourceSelector: process.env[ENV_VAR.FLAGD_SOURCE_SELECTOR],
  }),
});

export function getConfig(options: FlagdProviderOptions = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...getEnvVarConfig(),
    ...options,
  };
}
export function getInProcessConfig(options: FlagdProviderOptions = {}) {
  return {
    ...DEFAULT_INPROCESS_CONFIG,
    ...getEnvVarConfig(),
    ...options,
  };
}
