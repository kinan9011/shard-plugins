import { mountTool } from "./bootstrap";
import { VideoMetadataCleaner } from "@/components/tools/VideoMetadataCleaner";
import "./index.css";

void mountTool(VideoMetadataCleaner, { form: false });
