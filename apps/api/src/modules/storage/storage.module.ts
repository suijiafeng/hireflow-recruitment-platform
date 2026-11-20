import { Global, Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { StorageService } from './storage.service';

// 全局模块：简历、合同等多处需要文件存储
@Global()
@Module({
  controllers: [FilesController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
