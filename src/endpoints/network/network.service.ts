import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Stats } from 'src/endpoints/network/entities/stats';
import { ApiConfigService } from 'src/common/api.config.service';
import { ApiService } from 'src/common/api.service';
import { CachingService } from 'src/common/caching.service';
import { DataApiService } from 'src/common/data.api.service';
import { DataQuoteType } from 'src/common/entities/data.quote.type';
import { GatewayService } from 'src/common/gateway.service';
import { Constants } from 'src/utils/constants';
import { NumberUtils } from 'src/utils/number.utils';
import { AccountService } from '../accounts/account.service';
import { BlockService } from '../blocks/block.service';
import { BlockFilter } from '../blocks/entities/block.filter';
import { TransactionFilter } from '../transactions/entities/transaction.filter';
import { TransactionService } from '../transactions/transaction.service';
import { VmQueryService } from '../vm.query/vm.query.service';
import { NetworkConstants } from './entities/constants';
import { Economics } from './entities/economics';
import { NetworkConfig } from './entities/network.config';
import { StakeService } from '../stake/stake.service';

@Injectable()
export class NetworkService {
  constructor(
    private readonly apiConfigService: ApiConfigService,
    private readonly cachingService: CachingService,
    private readonly gatewayService: GatewayService,
    private readonly vmQueryService: VmQueryService,
    private readonly blockService: BlockService,
    private readonly accountService: AccountService,
    private readonly transactionService: TransactionService,
    private readonly dataApiService: DataApiService,
    private readonly apiService: ApiService,
    @Inject(forwardRef( () => StakeService))
    private readonly stakeService: StakeService
  ) {}

  async getConstants(): Promise<NetworkConstants> {
    const gatewayUrl = this.apiConfigService.getGatewayUrl();

    const {
      data: {
        data: {
          config: {
            erd_chain_id: chainId,
            // erd_denomination: denomination,
            erd_gas_per_data_byte: gasPerDataByte,
            erd_min_gas_limit: minGasLimit,
            erd_min_gas_price: minGasPrice,
            erd_min_transaction_version: minTransactionVersion,
            // erd_round_duration: roundDuration,
          },
        },
      },
    } = await this.apiService.get(`${gatewayUrl}/network/config`);

    return {
      chainId,
      gasPerDataByte,
      minGasLimit,
      minGasPrice,
      minTransactionVersion,
    };
  }

  async getNetworkConfig(): Promise<NetworkConfig> {
    const [
      {
        config: { erd_round_duration, erd_rounds_per_epoch },
      },
      {
        status: { erd_rounds_passed_in_current_epoch },
      },
    ] = await Promise.all([
      this.gatewayService.get('network/config'),
      this.gatewayService.get('network/status/4294967295'),
    ]);

    const roundsPassed = erd_rounds_passed_in_current_epoch;
    const roundsPerEpoch = erd_rounds_per_epoch;
    const roundDuration = erd_round_duration / 1000;

    return { roundsPassed, roundsPerEpoch, roundDuration };
  }

  async getEconomics(): Promise<Economics> {
    return this.cachingService.getOrSetCache(
      'economics',
      async () => await this.getEconomicsRaw(),
      Constants.oneMinute() * 10,
    );
  }

  private async getEconomicsRaw(): Promise<Economics> {
    const locked = 2660000;
    const [
      {
        account: { balance },
      },
      {
        metrics: { erd_total_supply },
      },
      [, totalWaitingStakeBase64],
      priceValue,
      marketCapValue,
    ] = await Promise.all([
      this.gatewayService.get(
        `address/${this.apiConfigService.getAuctionContractAddress()}`,
      ),
      this.gatewayService.get('network/economics'),
      this.vmQueryService.vmQuery(
        this.apiConfigService.getDelegationContractAddress(),
        'getTotalStakeByType',
      ),
      this.dataApiService.getQuotesHistoricalLatest(DataQuoteType.price),
      this.dataApiService.getQuotesHistoricalLatest(DataQuoteType.marketCap),
    ]);

    const totalWaitingStakeHex = Buffer.from(
      totalWaitingStakeBase64,
      'base64',
    ).toString('hex');
    const totalWaitingStake = BigInt(
      totalWaitingStakeHex ? '0x' + totalWaitingStakeHex : totalWaitingStakeHex,
    );

    const staked = parseInt(
      (BigInt(balance) + totalWaitingStake).toString().slice(0, -18),
    );
    const totalSupply = parseInt(erd_total_supply.slice(0, -18));

    const circulatingSupply = totalSupply - locked;

    const aprInfo = await this.getApr();

    return {
      totalSupply,
      circulatingSupply,
      staked,
      price: priceValue ? parseFloat(priceValue.toFixed(2)) : undefined,
      marketCap: marketCapValue
        ? parseInt(marketCapValue.toFixed(0))
        : undefined,
      apr: aprInfo.apr ? aprInfo.apr.toRounded(6) : 0,
      topUpApr: aprInfo.topUpApr ? aprInfo.topUpApr.toRounded(6) : 0,
      baseApr: aprInfo.baseApr ? aprInfo.baseApr.toRounded(6) : 0,
    };
  }

  async getStats(): Promise<Stats> {
    const metaChainShard = this.apiConfigService.getMetaChainShardId();

    const [
      {
        config: {
          erd_num_shards_without_meta: shards,
          erd_round_duration: refreshRate,
        },
      },
      {
        status: {
          erd_epoch_number: epoch,
          erd_rounds_passed_in_current_epoch: roundsPassed,
          erd_rounds_per_epoch: roundsPerEpoch,
        },
      },
      blocks,
      accounts,
      transactions,
    ] = await Promise.all([
      this.gatewayService.get('network/config'),
      this.gatewayService.get(`network/status/${metaChainShard}`),
      this.blockService.getBlocksCount(new BlockFilter()),
      this.accountService.getAccountsCount(),
      this.transactionService.getTransactionCount(new TransactionFilter()),
    ]);

    return {
      shards,
      blocks,
      accounts,
      transactions,
      refreshRate,
      epoch,
      roundsPassed,
      roundsPerEpoch,
    };
  }

  async getValidatorStatistics(): Promise<any> {
    return await this.gatewayService.get('validator/statistics');
  }

  async getApr(): Promise<{ apr: number; topUpApr: number; baseApr: number }> {
    const stats = await this.getStats();
    const config = await this.getNetworkConfig();
    const stake = await this.stakeService.getGlobalStake();
    const {
      account: { balance: stakedBalance },
    } = await this.gatewayService.get(
      `address/${this.apiConfigService.getAuctionContractAddress()}`,
    );
    let [activeStake] = await this.vmQueryService.vmQuery(
      this.apiConfigService.getDelegationContractAddress(),
      'getTotalActiveStake',
    );
    activeStake = this.numberDecode(activeStake);

    const elrondConfig = {
      feesInEpoch: 0,
      stakePerNode: 2500,
      protocolSustainabilityRewards: 0.1,
    };

    const feesInEpoch = elrondConfig.feesInEpoch;
    const stakePerNode = elrondConfig.stakePerNode;
    const protocolSustainabilityRewards =
      elrondConfig.protocolSustainabilityRewards;
    const epochDuration = (config.roundDuration / 1000) * config.roundsPerEpoch;
    const secondsInYear = 365 * 24 * 3600;
    const epochsInYear = secondsInYear / epochDuration;

    const yearIndex = Math.floor(stats.epoch / epochsInYear);
    const inflationAmounts = this.apiConfigService.getInflationAmounts();

    if (yearIndex >= inflationAmounts.length) {
      throw new Error(
        `There is no inflation information for year with index ${yearIndex}`,
      );
    }

    const inflation = inflationAmounts[yearIndex];
    const rewardsPerEpoch = Math.max(inflation / epochsInYear, feesInEpoch);

    const rewardsPerEpochWithoutProtocolSustainability =
      (1 - protocolSustainabilityRewards) * rewardsPerEpoch;
    const topUpRewardsLimit =
      0.5 * rewardsPerEpochWithoutProtocolSustainability;
    const networkBaseStake = stake.activeValidators * stakePerNode;
    const networkTotalStake = NumberUtils.denominateString(stakedBalance);

    const networkTopUpStake =
      networkTotalStake -
      stake.totalValidators * stakePerNode -
      stake.queueSize * stakePerNode;

    const topUpReward =
      ((2 * topUpRewardsLimit) / Math.PI) *
      Math.atan(networkTopUpStake / (2 * 2000000));
    const baseReward =
      rewardsPerEpochWithoutProtocolSustainability - topUpReward;

    const apr = (epochsInYear * (topUpReward + baseReward)) / networkTotalStake;

    const topUpApr = (epochsInYear * topUpReward) / networkTopUpStake;
    const baseApr = (epochsInYear * baseReward) / networkBaseStake;

    return { apr, topUpApr, baseApr };
  }

  numberDecode(encoded: string): string {
    const hex = Buffer.from(encoded, 'base64').toString('hex');
    return BigInt(hex ? '0x' + hex : hex).toString();
  }
}
