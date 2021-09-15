import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { ApiConfigService } from './api.config.service';
import { PerformanceProfiler } from '../utils/performance.profiler';
import Agent from 'agentkeepalive';
import { MetricsService } from 'src/endpoints/metrics/metrics.service';

@Injectable()
export class ApiService {
  private readonly defaultTimeout: number = 30000;
  private readonly keepaliveAgent = new Agent({
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: this.apiConfigService.getAxiosTimeout(), // active socket keepalive
    freeSocketTimeout: 30000, // free socket keepalive for 30 seconds
  });

  constructor(
    private readonly apiConfigService: ApiConfigService,
    @Inject(forwardRef(() => MetricsService))
    private readonly metricsService: MetricsService,
  ) {}

  private getConfig(timeout: number | undefined): AxiosRequestConfig {
    timeout = timeout || this.defaultTimeout;

    const headers = {};

    const rateLimiterSecret = this.apiConfigService.getRateLimiterSecret();
    if (rateLimiterSecret) {
      // @ts-ignore
      headers['x-rate-limiter-secret'] = rateLimiterSecret;
    }

    return {
      timeout,
      httpAgent: this.keepaliveAgent,
      headers,
      transformResponse: [
        (data) => {
          try {
            return JSON.parse(data);
          } catch (error) {
            return data;
          }
        },
      ],
    };
  }

  async get(
    url: string,
    timeout: number | undefined = undefined,
    errorHandler?: (error: any) => Promise<boolean>,
  ): Promise<any> {
    timeout = timeout || this.defaultTimeout;

    const profiler = new PerformanceProfiler();

    try {
      return await axios.get(url, this.getConfig(timeout));
    } catch (error) {
      let handled = false;
      if (errorHandler) {
        handled = await errorHandler(error);
      }

      if (!handled) {
        const logger = new Logger(ApiService.name);
        logger.error({
          method: 'GET',
          url,
          response: error.response?.data,
          status: error.response?.status,
          message: error.message,
          name: error.name,
        });

        throw error;
      }
    } finally {
      profiler.stop();
      this.metricsService.setExternalCall(
        this.getHostname(url),
        profiler.duration,
      );
    }
  }

  async post(
    url: string,
    data: any,
    timeout: number | undefined = undefined,
    errorHandler?: (error: any) => Promise<boolean>,
  ): Promise<any> {
    timeout = timeout || this.defaultTimeout;

    const profiler = new PerformanceProfiler();

    try {
      return await axios.post(url, data, this.getConfig(timeout));
    } catch (error) {
      let handled = false;
      if (errorHandler) {
        handled = await errorHandler(error);
      }

      if (!handled) {
        const logger = new Logger(ApiService.name);
        logger.error({
          method: 'POST',
          url,
          body: data,
          response: error.response?.data,
          status: error.response?.status,
          message: error.message,
          name: error.name,
        });

        throw error;
      }
    } finally {
      profiler.stop();
      this.metricsService.setExternalCall(
        this.getHostname(url),
        profiler.duration,
      );
    }
  }

  async head(
    url: string,
    timeout: number | undefined = undefined,
    errorHandler?: (error: any) => Promise<boolean>,
  ): Promise<any> {
    timeout = timeout || this.defaultTimeout;

    const profiler = new PerformanceProfiler();

    try {
      return await axios.head(url, this.getConfig(timeout));
    } catch (error) {
      let handled = false;
      if (errorHandler) {
        handled = await errorHandler(error);
      }

      if (!handled) {
        const logger = new Logger(ApiService.name);
        logger.error({
          method: 'HEAD',
          url,
          response: error.response?.data,
          status: error.response?.status,
          message: error.message,
          name: error.name,
        });

        throw error;
      }
    } finally {
      profiler.stop();
      this.metricsService.setExternalCall(
        this.getHostname(url),
        profiler.duration,
      );
    }
  }

  private getHostname(url: string): string {
    return new URL(url).hostname;
  }
}
