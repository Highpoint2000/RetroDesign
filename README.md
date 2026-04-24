# Retro Design Elements for [FM-DX-Webserver](https://github.com/NoobishSVK/fm-dx-webserver)
Analog frequency display, manual frequency rotary control and VU meter, as well as Magic Eye for the FM-DX web server

<img width="1310" height="874" alt="Screenshot 2026-04-23 121834" src="https://github.com/user-attachments/assets/a64b406f-f430-4e2b-a3b9-609e0f6777c8" />

## Version 1.1

- Integration of the Spectrum plugin
- Slider customization for Firefox browser
- Dynamic resizing of the Magic Eye
- Performance optimizations

### Note: [Enhanced Tuning](https://github.com/Overland-DX/Enhanced-Tuning) users do not need this plugin, as it is already an extended component in newer versions there! The analog frequency display is designed for FM use only. AM users, please install the Enhanced Tuning Plugin!
 
## Installation notes

1. 	Download the last repository as a zip
2.	Unpack the RetroDesignPlugin.js and the RetroDesign folder with the retrodesign.js into the web server plugins folder (..fm-dx-webserver-main\plugins)
3. 	Restart the server
4. 	Activate the plugin it in the settings
5.  Enable autostart in the settings and/or adjust the brightness

## How to use

- Main Scale Tuning: Click and drag the frequency scale left or right to adjust the frequency with smooth, animated movement.
- Dual-Concentric Knob Operation: Use the large outer silver ring for standard 100 kHz tuning steps, while the inner center knob provides fine-tuning adjustments.
- Fine Tuning Mode: A single click on the inner knob toggles high-precision mode—indicated by the dimple turning blue—enabling 10x smaller frequency steps for exact calibration.
- Grid Snapping: Double-click the inner knob to instantly snap the frequency to the nearest standard 0.1 MHz grid.
- Autostart Toggle: Enable or disable the automatic launch of the FM Scale upon page load.
- Visual Component Toggles: Independently turn the Analog VU Meter and the Magic Eye on or off according to your preference.
- Spectrum Plugin Integration: Make sure the spectrum plugin is active, then activate the FM scale. To refresh the spectrum, use the refresh icon that appears.
 
## Contact

If you have any questions, would like to report problems, or have suggestions for improvement, please feel free to contact me! You can reach me by email at highpoint2000@googlemail.com. I look forward to hearing from you!

<a href="https://www.buymeacoffee.com/Highpoint" target="_blank"><img src="https://tef.noobish.eu/logos/images/buymeacoffee/default-yellow.png" alt="Buy Me A Coffee" ></a>

<details>
<summary>History</summary>

### Version 1.0

- Dynamic Theme Adaptation: Automatically synchronizes scale colors and lighting with the active web server CSS theme.
- Integrated UI Settings: Adds toggles for Autostart, Analog VU Meter, and Magic Eye, plus a Brightness slider, directly to the modal menu.
- Dual Analog VU Meter: Side-by-side meters for left and right audio channels with realistic ballistics
- Magic Eye: Real-time signal and audio-modulated tuning indicator based on vintage cathode-ray tube behavior
- Fine Tuning Mode: Toggleable high-precision tuning (10x smaller steps) with visual dimple color feedback.
- Automatic Frequency Limits: Detects FM limits from the server config to ensure accurate scale calibration.