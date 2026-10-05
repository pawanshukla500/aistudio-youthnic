import { ImageGeneration } from "@/components/ui/ai-chat-image-generation-1";
import { ImageSliderLoginDemo } from "@/components/ui/image-slider-login-demo";

export { ImageSliderLoginDemo };

export function ImageGenerationDemo() {
  return (
    <div className="w-full min-h-dvh flex justify-center items-center p-6 bg-paper-canvas">
      <ImageGeneration>
        <img
          className="aspect-video max-w-md object-cover rounded-lg"
          src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=800&q=80"
          alt="Youthnic fashion generation preview"
        />
      </ImageGeneration>
    </div>
  );
}

export default ImageSliderLoginDemo;
