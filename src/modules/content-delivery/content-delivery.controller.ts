import { Controller, Get, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { ContentDeliveryService } from "./content-delivery.service";

@Controller(["content/delivery", "v1/content/delivery"])
export class ContentDeliveryController {
  constructor(private contentDelivery: ContentDeliveryService) {}

  @Get(":token")
  async download(@Param("token") token: string, @Res() response: Response) {
    const asset = await this.contentDelivery.resolveDownload(token);

    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Accept-Ranges", "bytes");
    if (asset.contentSizeBytes !== null) {
      response.setHeader("X-Content-Size-Bytes", String(asset.contentSizeBytes));
    }
    if (asset.contentChecksum) {
      response.setHeader("X-Content-Checksum-Sha256", asset.contentChecksum);
    }

    return response.redirect(302, asset.url);
  }
}
