import { Controller, Get } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { Distribution, DistributionService } from './distribution.service';

@Controller()
@ApiTags('Distribution')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @Get('/getDistribution')
  @ApiResponse({
    status: 200,
    description: 'The delegators distribution for all providers',
  })
  async getBlocks(): Promise<Distribution> {
    return await this.distributionService.getDistribution();
  }
}
