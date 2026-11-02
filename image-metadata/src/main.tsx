import { mountTool } from "./bootstrap";
import { ImageMetadataCleaner } from "@/components/tools/ImageMetadataCleaner";
import "./index.css";

void mountTool(ImageMetadataCleaner, { form: false });
