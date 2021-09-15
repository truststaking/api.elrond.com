import { ApiProperty } from '@nestjs/swagger';
import { Round } from './round';

export class RoundDetailed extends Round {
  @ApiProperty()
  signers: string[] = [];
}
