import { ApiProperty } from '@nestjs/swagger';

export class Provider {
  @ApiProperty()
  provider = '';

  @ApiProperty()
  owner: string | null = null;

  @ApiProperty()
  featured = false;

  @ApiProperty()
  serviceFee = 0;

  @ApiProperty()
  delegationCap = '';

  @ApiProperty()
  apr = 0;

  @ApiProperty()
  numUsers = 0;

  @ApiProperty()
  numNodes = 0;

  @ApiProperty()
  cumulatedRewards: string | null = null;

  @ApiProperty()
  identity: string | undefined = undefined;

  @ApiProperty()
  stake = '';

  @ApiProperty()
  topUp = '';

  @ApiProperty()
  locked = '';
}
