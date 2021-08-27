import { ApiProperty } from '@nestjs/swagger';

export class Identity {
  @ApiProperty()
  avatar = '';

  @ApiProperty()
  description = '';

  @ApiProperty()
  distribution: { [index: string]: number } = {};

  @ApiProperty()
  identity = '';

  @ApiProperty()
  locked = '';

  @ApiProperty()
  name = '';

  @ApiProperty()
  rank = 0;

  @ApiProperty()
  score = '';

  @ApiProperty()
  stake = '';

  @ApiProperty()
  stakePercent = 0;

  @ApiProperty()
  topup = '';

  @ApiProperty()
  validators = 0;
}
