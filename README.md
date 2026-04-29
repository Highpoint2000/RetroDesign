
# Retro Design Elements for [FM-DX-Webserver](https://github.com/NoobishSVK/fm-dx-webserver)
Analog frequency display, manual frequency rotary control and VU meter, as well as Magic Eye for the FM-DX web server

<img width="350" height="230" alt="Screenshot 2026-04-29 153031" src="https://github.com/user-attachments/assets/bad13262-4814-45c7-945c-372346f155b6" />

<img width="350" height="230" alt="retrodesign2" src="https://github.com/user-attachments/assets/df67643b-4ac5-4033-a0bd-b48d3a2cd95f" />

<img width="350" height="230" alt="retrodesign1" src="https://github.com/user-attachments/assets/34d1bfbd-148c-428c-b0ea-383e015f03f1" />

<img width="350" height="230" alt="retrodesign3" src="https://github.com/user-attachments/assets/bd95270e-d405-469a-a3b8-d1473c9cb1b2" />


## Version 1.3

- Switchable Nixie tubes adaptation for radio displays implemented

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
- Nixie Tubes Displays: You can use the switch in the web server side panel to turn off the Nixie tube display if needed.

### Keyboard Shortcuts
    airrow left  - frequency down (100 KHz step)
    airrow right - frequency up (100 KHz step)
    airrow up    - frequency up (10 KHz step)
    airrow down  - frequency down (10 KHz step)
    F or f       - open/close FM Scale

### PS Scale

    - PS entries are automatically displayed in a stepped format below the frequency display 
    - Mouseover over a PS entry displays saved TX information and last seen information
    - PS entries are automatically deleted after 3 seconds if the frequency is empty
    - The X Button on the left side deletes all saved PS entries
    
## Contact

If you have any questions, would like to report problems, or have suggestions for improvement, please feel free to contact me! You can reach me by email at highpoint2000@googlemail.com. I look forward to hearing from you!

<a href="https://www.buymeacoffee.com/Highpoint" target="_blank"><img src="https://tef.noobish.eu/logos/images/buymeacoffee/default-yellow.png" alt="Buy Me A Coffee" ></a>

<details>
<summary>History</summary>

### Version 1.2a

- Shortcut "f" or "F" added to toggle the FM Scale Button (open/close FM Scale)
- Rounded corner design

### Version 1.2

- Automatic PS display names added as a stepped display below the scale; can be deactivated in the web server's side menu.
- Automatic deletion of individual PS entries after 3 seconds if the frequency is empty.
- Added a delete button to globally reset all saved PS entries.
- Mouseover over a PS entry displays saved TX information and last seen information.
- Added support for arrow keys to control the frequency via the keyboard, enabling the use of external wheelsets (e.g., Ulanzi Dial D100H).


### Version 1.1

- Integration of the Spectrum plugin
- Slider customization for Firefox browser
- Dynamic resizing of the Magic Eye
- Design switching now occurs without a reload
- Performance optimizations

### Version 1.0

- Dynamic Theme Adaptation: Automatically synchronizes scale colors and lighting with the active web server CSS theme.
- Integrated UI Settings: Adds toggles for Autostart, Analog VU Meter, and Magic Eye, plus a Brightness slider, directly to the modal menu.
- Dual Analog VU Meter: Side-by-side meters for left and right audio channels with realistic ballistics
- Magic Eye: Real-time signal and audio-modulated tuning indicator based on vintage cathode-ray tube behavior
- Fine Tuning Mode: Toggleable high-precision tuning (10x smaller steps) with visual dimple color feedback.
- Automatic Frequency Limits: Detects FM limits from the server config to ensure accurate scale calibration.
