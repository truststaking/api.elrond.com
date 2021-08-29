import { Controller, Get, Param } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { DelegationLegacyService } from './delegation.legacy.service';
import { AccountDelegationLegacy } from './entities/account.delegation.legacy';
import { DelegationLegacy } from './entities/delegation.legacy';

@Controller()
@ApiTags('delegation')
export class DelegationLegacyController {
  constructor(
    private readonly delegationLegacyService: DelegationLegacyService,
  ) {}

  @Get('/delegation-legacy')
  @ApiResponse({
    status: 200,
    description: 'The delegation legacy details',
    type: DelegationLegacy,
  })
  async getBlock(): Promise<DelegationLegacy> {
    return await this.delegationLegacyService.getDelegation();
  }
  @Get('/delegation-legacy/:address')
  @ApiResponse({
    status: 200,
    description: 'The delegation legacy details for an address',
    type: AccountDelegationLegacy,
  })
  async getLegacy(
    @Param('address') address: string,
  ): Promise<AccountDelegationLegacy> {
    return await this.delegationLegacyService.getDelegationForAddress(address);
  }
}
