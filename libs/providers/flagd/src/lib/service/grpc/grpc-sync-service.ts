import { ClientReadableStream, ClientUnaryCall, ServiceError, credentials, status } from '@grpc/grpc-js';
import {
  EvaluationContext,
  FlagNotFoundError,
  FlagValue,
  GeneralError,
  JsonValue,
  Logger,
  ParseError,
  ResolutionDetails,
  StandardResolutionReasons,
  TypeMismatchError,
} from '@openfeature/js-sdk';
import { LRUCache } from 'lru-cache';
import { promisify } from 'util';
import {
  EventStreamResponse,
  ResolveBooleanRequest,
  ResolveBooleanResponse,
  ResolveFloatRequest,
  ResolveFloatResponse,
  ResolveIntRequest,
  ResolveIntResponse,
  ResolveObjectRequest,
  ResolveObjectResponse,
  ResolveStringRequest,
  ResolveStringResponse,
  ServiceClient,
} from '../../../proto/ts/schema/v1/schema';
import {Config, InProcessConfig} from '../../configuration';
import {
  BASE_EVENT_STREAM_RETRY_BACKOFF_MS,
  DEFAULT_MAX_CACHE_SIZE,
  DEFAULT_MAX_EVENT_STREAM_RETRIES,
  EVENT_CONFIGURATION_CHANGE,
  EVENT_PROVIDER_READY,
} from '../../constants';
import { FlagdProvider } from '../../flagd-provider';
import { Service } from '../service';
import {
  FlagSyncServiceClient,
  SyncFlagsRequest,
  SyncFlagsResponse,
  SyncState
} from "../../../proto/ts/sync/v1/sync_service";

type AnyResponse =
  | ResolveBooleanResponse
  | ResolveStringResponse
  | ResolveIntResponse
  | ResolveFloatResponse
  | ResolveObjectResponse;
type AnyRequest =
  | ResolveBooleanRequest
  | ResolveStringRequest
  | ResolveIntRequest
  | ResolveFloatRequest
  | ResolveObjectRequest;

interface FlagChange {
  type: 'delete' | 'write' | 'update';
  source: string;
  flagKey: string;
}

export interface FlagChangeMessage {
  flags?: { [key: string]: FlagChange };
}

// see: https://grpc.github.io/grpc/core/md_doc_statuscodes.html
export const Codes = {
  InvalidArgument: 'INVALID_ARGUMENT',
  NotFound: 'NOT_FOUND',
  DataLoss: 'DATA_LOSS',
  Unavailable: 'UNAVAILABLE',
} as const;

export class GRPCSyncService implements Service {
  private _config: InProcessConfig;
  private _flagConfig: object;
  private _client: FlagSyncServiceClient;
  private _streamAlive = false;
  private _streamConnectAttempt = 0;
  private _stream: ClientReadableStream<SyncFlagsResponse> | undefined = undefined;
  private _streamConnectBackoff = BASE_EVENT_STREAM_RETRY_BACKOFF_MS;
  private _maxEventStreamRetries;

  constructor(
    config: InProcessConfig,
    client?: FlagSyncServiceClient,
    private logger?: Logger,
  ) {
    this._config = config;
    this._maxEventStreamRetries = config.maxEventStreamRetries ?? DEFAULT_MAX_EVENT_STREAM_RETRIES;
    this._client = client
      ? client
      : new FlagSyncServiceClient(
        this._config.socketPath ? `unix://${this._config.socketPath}` : `${this._config.host}:${this._config.port}`,
        this._config.tls ? credentials.createSsl() : credentials.createInsecure(),
        );
  }

  connect(
    connectCallback: () => void,
    changedCallback: (flagsChanged: string[]) => void,
    disconnectCallback: () => void,
  ): Promise<void> {
    return this.connectStream(connectCallback, changedCallback, disconnectCallback);
  }

  async disconnect(): Promise<void> {
    // cancel the stream and close the connection
    this._stream?.cancel();
    this._client.close();
  }

  async resolveBoolean(
    flagKey: string,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<boolean>> {
    // TODO resolve json logic of local flag config
    // TODO abstract this out into a separate thing for easier testing
  }

  async resolveString(flagKey: string, context: EvaluationContext, logger: Logger): Promise<ResolutionDetails<string>> {
    // TODO resolve json logic of local flag config
    // TODO abstract this out into a separate thing for easier testing
  }

  async resolveNumber(flagKey: string, context: EvaluationContext, logger: Logger): Promise<ResolutionDetails<number>> {
    // TODO resolve json logic of local flag config
    // TODO abstract this out into a separate thing for easier testing
  }

  async resolveObject<T extends JsonValue>(
    flagKey: string,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<T>> {
    // TODO resolve json logic of local flag config
    // TODO abstract this out into a separate thing for easier testing
  }

  private connectStream(
    connectCallback: () => void,
    changedCallback: (flagsChanged: string[]) => void,
    disconnectCallback: () => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger?.debug(`${FlagdProvider.name}: connecting stream, attempt ${this._streamConnectAttempt}...`);
      const syncRequest: SyncFlagsRequest = {
        providerId: this._config.flagDSourceUri,
        selector: this._config.flagDSourceSelector,
      };

      const stream = this._client.syncFlags(syncRequest, {});
      stream.on('error', (err: ServiceError | undefined) => {
        if (err?.code === status.CANCELLED) {
          this.logger?.debug(`${FlagdProvider.name}: stream cancelled, will not be re-established`);
        } else {
          this.handleError(reject, connectCallback, changedCallback, disconnectCallback);
        }
      });
      stream.on('close', () => {
        this.handleClose();
      });
      stream.on('data', (message) => {
        //TODO check for sync all, fill up cache, set singleton config object, call changed handler
        // TODO all other states: just print a warning
        if (message.type === SyncState.SYNC_STATE_ALL) {
          this.handleFlagsChanged(message, changedCallback);
          this.handleProviderReady(resolve, connectCallback);
        } else {
          this.logger?.debug(`${FlagdProvider.name}: unknown message type was received`);
        }
      });
      this._stream = stream;
    });
  }

  private handleProviderReady(resolve: () => void, connectCallback: () => void) {
    connectCallback();
    this.logger?.info(`${FlagdProvider.name}: streaming connection established with flagd`);
    this._streamAlive = true;
    this._streamConnectAttempt = 0;
    this._streamConnectBackoff = BASE_EVENT_STREAM_RETRY_BACKOFF_MS;
    resolve();
  }

  private handleFlagsChanged(message: EventStreamResponse, changedCallback: (flagsChanged: string[]) => void) {
    if (message.data) {
      const data = message.data;
      this.logger?.debug(`${FlagdProvider.name}: got message: ${JSON.stringify(data, undefined, 2)}`);
      if (data && typeof data === 'object' && 'flags' in data && data?.['flags']) {
        const flagChangeMessage = data as FlagChangeMessage;
        const flagsChanged: string[] = Object.keys(flagChangeMessage.flags || []);
        changedCallback(flagsChanged);
      }
    }
  }

  private handleError(
    reject: (reason?: Error) => void,
    connectCallback: () => void,
    changedCallback: (flagsChanged: string[]) => void,
    disconnectCallback: () => void,
  ) {
    disconnectCallback();
    this.logger?.error(`${FlagdProvider.name}: streaming connection error, will attempt reconnect...`);
    // TODO clear local copy of flag config
    this._streamAlive = false;

    // if we haven't reached max attempt, reconnect after backoff
    if (this._streamConnectAttempt <= this._maxEventStreamRetries) {
      this._streamConnectAttempt++;
      setTimeout(() => {
        this._streamConnectBackoff = this._streamConnectBackoff * 2;
        this.connectStream(connectCallback, changedCallback, disconnectCallback).catch(() => {
          // empty catch to avoid unhandled promise rejection
        });
      }, this._streamConnectBackoff);
    } else {
      // after max attempts, give up
      const errorMessage = `${FlagdProvider.name}: max stream connect attempts (${this._maxEventStreamRetries} reached)`;
      this.logger?.error(errorMessage);
      reject(new Error(errorMessage));
    }
  }

  private handleClose() {
    this.logger?.info(`${FlagdProvider.name}: streaming connection closed`);
    // TODO clear local copy of flag config
    this._streamAlive = false;
  }

  private async resolve<T extends FlagValue>(
    promise: (
      request: AnyRequest,
      callback: (error: ServiceError | null, response: AnyResponse) => void,
    ) => ClientUnaryCall,
    flagKey: string,
    context: EvaluationContext,
    logger: Logger,
  ): Promise<ResolutionDetails<T>> {
    const resolver = promisify(promise);

    // invoke the passed resolver method
    const response = await resolver
      .call(this._client, { flagKey, context })
      .then((resolved) => resolved, this.onRejected);

    const resolved: ResolutionDetails<T>  = {
      value: response.value as T,
      reason: response.reason,
      variant: response.variant,
      flagMetadata: response.metadata,
    };

    logger.debug(
      `${FlagdProvider.name}: resolved flag with key: ${resolved.value}, variant: ${response.variant}, reason: ${response.reason}`,
    );
    return resolved;
  }

  private onRejected = (err: ServiceError | undefined) => {
    // map the errors
    switch (err?.code) {
      case status.DATA_LOSS:
        throw new ParseError(err.details);
      case status.INVALID_ARGUMENT:
        throw new TypeMismatchError(err.details);
      case status.NOT_FOUND:
        throw new FlagNotFoundError(err.details);
      case status.UNAVAILABLE:
        throw new FlagNotFoundError(err.details);
      default:
        throw new GeneralError(err?.details);
    }
  };
}
