import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  ClientOptions,
  Transport,
  ClientProxyFactory,
} from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from 'config/configuration';
import { ApiConfigService } from './common/api.config.service';
import { TransactionProcessorService } from './crons/transaction.processor.service';
import { ElrondTaxService } from './crons/elrondtax.service';
import { PublicAppModule } from './public.app.module';
import { EventsGateway } from './websockets/events.gateway';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      load: [configuration],
    }),
    PublicAppModule,
  ],
  controllers: [],
  providers: [
    TransactionProcessorService,
    ElrondTaxService,
    EventsGateway,
    {
      provide: 'PUBSUB_SERVICE',
      useFactory: (apiConfigService: ApiConfigService) => {
        const clientOptions: ClientOptions = {
          transport: Transport.REDIS,
          options: {
            url: `redis://${apiConfigService.getRedisUrl()}:6379`,
            retryDelay: 1000,
            retryAttempts: 10,
            retry_strategy: function (_: any) {
              return 1000;
            },
          },
        };

        return ClientProxyFactory.create(clientOptions);
      },
      inject: [ApiConfigService],
    },
  ],
})
export class TransactionProcessorModule {}
