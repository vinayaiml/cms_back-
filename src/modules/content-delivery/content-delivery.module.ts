import { Module } from "@nestjs/common";
import { ContentDeliveryController } from "./content-delivery.controller";
import { ContentDeliveryService } from "./content-delivery.service";

@Module({
  controllers: [ContentDeliveryController],
  providers: [ContentDeliveryService],
  exports: [ContentDeliveryService],
})
export class ContentDeliveryModule {}
