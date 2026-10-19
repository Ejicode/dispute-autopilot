// Package storefront reproduces the demo storefront catalog and checkout flow
// from src/lib/storefront and src/app/api/storefront/checkout/route.ts.
package storefront

// product is the catalog record defined by src/lib/storefront/catalog.ts.
type product struct {
	ID             string
	Name           string
	Brand          string
	Category       string
	SKU            string
	PriceCents     int64
	Rating         float64
	ReviewsCount   int64
	Stock          int64
	ImageURL       string
	Description    string
	Specs          map[string]string
	CarrierDefault string
}

func newProduct(id, name, brand, category, sku string, priceCents int64, rating float64, reviewsCount, stock int64, imageURL, description string, specs map[string]string, carrierDefault string) product {
	return product{
		ID:             id,
		Name:           name,
		Brand:          brand,
		Category:       category,
		SKU:            sku,
		PriceCents:     priceCents,
		Rating:         rating,
		ReviewsCount:   reviewsCount,
		Stock:          stock,
		ImageURL:       imageURL,
		Description:    description,
		Specs:          specs,
		CarrierDefault: carrierDefault,
	}
}

// catalog is a verbatim port of PRODUCTS in src/lib/storefront/catalog.ts.
var catalog = []product{
	// ── 1. Drones & Cameras (8 products) ──
	newProduct("prod_1", "DJI Mavic 3 Pro Cine Drone", "DJI", "Drones & Cameras", "DJI-M3P-CINE", 219900, 4.9, 328, 14,
		"https://images.unsplash.com/photo-1527977966376-1c8408f9f108?auto=format&fit=crop&w=600&q=80",
		"Flagship triple-camera system featuring Hasselblad 4/3 CMOS, dual tele-cameras, 43-min flight time, and omnidirectional obstacle sensing.",
		map[string]string{"Sensor": "4/3 CMOS Hasselblad", "Video": "5.1K/50fps Apple ProRes", "Flight Time": "43 Mins", "Range": "15 km O3+ Transmission", "Weight": "958g"}, "USPS"),
	newProduct("prod_2", "Sony Alpha A7 IV Mirrorless Camera", "Sony", "Drones & Cameras", "SONY-A7M4-BODY", 249800, 4.9, 512, 19,
		"https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80",
		"33MP full-frame Exmor R back-illuminated sensor, 4K 60p 10-bit 4:2:2 recording, real-time eye AF, and 759-point phase detection AF.",
		map[string]string{"Sensor": "33MP Full-Frame Exmor R", "ISO": "100-51200", "Autofocus": "759 Phase Points", "Stabilization": "5-axis In-body 5.5-step", "Weight": "658g"}, "FEDEX"),
	newProduct("prod_3", "GoPro HERO12 Black Action Camera", "GoPro", "Drones & Cameras", "GOPRO-H12-BLK", 39900, 4.7, 894, 45,
		"https://images.unsplash.com/photo-1565849904461-04a58ad377e0?auto=format&fit=crop&w=600&q=80",
		"Waterproof action camera with 5.3K60 HDR video, HyperSmooth 6.0 stabilization with 360 Horizon Lock, and Bluetooth audio support.",
		map[string]string{"Video": "5.3K/60fps, 4K/120fps", "Photo": "27MP Raw", "Waterproof": "33ft (10m) native", "Battery": "Enduro 1720mAh", "Weight": "154g"}, "USPS"),
	newProduct("prod_4", "Insta360 X4 8K 360 Waterproof Camera", "Insta360", "Drones & Cameras", "INSTA-X4-8K", 49900, 4.8, 421, 28,
		"https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=600&q=80",
		"Groundbreaking 8K 360-degree capture with invisible selfie stick effect, AI gesture control, and rugged waterproof construction.",
		map[string]string{"Resolution": "8K 30fps 360", "Stabilization": "FlowState + Horizon Lock", "Battery": "2290mAh (135 mins)", "Screen": "2.5-inch Gorilla Glass", "Weight": "203g"}, "USPS"),
	newProduct("prod_5", "DJI Mini 4 Pro Fly More Combo", "DJI", "Drones & Cameras", "DJI-MINI4P-FMC", 109900, 4.9, 630, 22,
		"https://images.unsplash.com/photo-1508614589041-895b88991e3e?auto=format&fit=crop&w=600&q=80",
		"Under-249g ultralight drone featuring omnidirectional obstacle sensing, 4K/60fps HDR true vertical shooting, and 20km FHD transmission.",
		map[string]string{"Weight": "< 249g (No FAA reg needed)", "Video": "4K/60fps HDR", "Flight Time": "34 Mins per battery", "Sensor": "1/1.3-inch CMOS f/1.7", "Transmission": "O4 20km"}, "USPS"),
	newProduct("prod_6", "Fujifilm X-T5 Mirrorless Camera (Silver)", "Fujifilm", "Drones & Cameras", "FUJI-XT5-SLV", 169900, 4.8, 310, 12,
		"https://images.unsplash.com/photo-1512790182412-b19e6d62bc39?auto=format&fit=crop&w=600&q=80",
		"40.2MP X-Trans CMOS 5 HR sensor with 7.0 stops of in-body image stabilization, classic analog dial layout, and 1/180,000s max shutter speed.",
		map[string]string{"Sensor": "40.2MP APS-C X-Trans", "IBIS": "7.0 Stops", "Video": "6.2K/30p 4:2:2 10-Bit", "Display": "3-way tilting LCD", "Weight": "557g"}, "UPS"),
	newProduct("prod_7", "Canon EOS R6 Mark II Full-Frame", "Canon", "Drones & Cameras", "CANON-R6M2-BODY", 229900, 4.9, 440, 16,
		"https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=80",
		"24.2MP CMOS sensor with continuous shooting up to 40 fps electronic shutter, 6K oversampled uncropped 4K 60p, and Dual Pixel CMOS AF II.",
		map[string]string{"Sensor": "24.2MP Full-Frame CMOS", "Speed": "40 fps Electronic", "Autofocus": "Dual Pixel CMOS AF II", "IBIS": "Up to 8.0 Stops", "Card Slots": "Dual UHS-II SD"}, "FEDEX"),
	newProduct("prod_8", "DJI Osmo Pocket 3 Creator Combo", "DJI", "Drones & Cameras", "DJI-POCKET3-CC", 66900, 4.9, 780, 31,
		"https://images.unsplash.com/photo-1495707902641-75cac588d2e9?auto=format&fit=crop&w=600&q=80",
		"Pocket-sized gimbal camera with 1-inch CMOS sensor, 2-inch rotatable OLED touchscreen, 4K/120fps recording, and full-pixel fast focusing.",
		map[string]string{"Sensor": "1-inch CMOS", "Screen": "2.0-inch Rotatable OLED", "Stabilization": "3-Axis Mechanical", "Mic": "DJI Mic 2 Transmitter Included", "Weight": "179g"}, "USPS"),

	// ── 2. Audio & Studio Sound (8 products) ──
	newProduct("prod_9", "Sony WH-1000XM5 Wireless Headphones", "Sony", "Audio & Sound", "SONY-WH1000XM5-BLK", 39900, 4.8, 1420, 52,
		"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80",
		"Industry-leading noise cancellation with Auto NC Optimizer, 8 microphones, 30-hr battery life with ultra-quick charging, and LDAC audio.",
		map[string]string{"Battery": "30 Hours (ANC On)", "Driver": "30mm Precision Engineered", "Codecs": "LDAC, AAC, SBC", "Weight": "250g", "Multipoint": "2 Devices Simultaneous"}, "USPS"),
	newProduct("prod_10", "Bose QuietComfort Ultra Headphones", "Bose", "Audio & Sound", "BOSE-QC-ULTRA-BLK", 42900, 4.8, 870, 38,
		"https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=600&q=80",
		"Breakthrough spatialized audio with Bose Immersive Audio, custom acoustic architecture, CustomTune sound calibration, and lush comfort.",
		map[string]string{"Battery": "24 Hours (18 hrs Immersive)", "Noise Cancelling": "Quiet, Aware, Immersion", "Microphones": "Beamforming Array", "Bluetooth": "5.3 with Snapdragon Sound", "Weight": "252g"}, "USPS"),
	newProduct("prod_11", "Apple AirPods Max (Space Gray)", "Apple", "Audio & Sound", "APPL-AIRPODS-MAX-SG", 54900, 4.7, 1105, 24,
		"https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=600&q=80",
		"Apple-designed dynamic driver providing high-fidelity audio, computational audio with H1 chips in each cup, active noise cancellation, and Spatial Audio.",
		map[string]string{"Chassis": "Anodized Aluminum & Mesh", "Chip": "Dual Apple H1", "Battery": "20 Hours with ANC", "Audio": "Personalized Spatial Audio", "Weight": "384.8g"}, "UPS"),
	newProduct("prod_12", "Sennheiser Momentum 4 Wireless", "Sennheiser", "Audio & Sound", "SENN-M4-BLK", 34900, 4.7, 640, 29,
		"https://images.unsplash.com/photo-1484704849700-f032a568e944?auto=format&fit=crop&w=600&q=80",
		"Signature Sennheiser sound with an astounding 60-hour battery life, 42mm transducer system, adaptive noise cancellation, and sound personalization.",
		map[string]string{"Battery": "60 Hours Marathon Life", "Transducer": "42mm Audiophile Grade", "Frequency": "6 Hz - 22 kHz", "Codecs": "aptX Adaptive, AAC, SBC", "Weight": "293g"}, "USPS"),
	newProduct("prod_13", "Shure SM7B Vocal Dynamic Microphone", "Shure", "Audio & Sound", "SHURE-SM7B-STUDIO", 39900, 5.0, 2190, 40,
		"https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=600&q=80",
		"The gold standard for broadcast, podcasting, and vocal recording. Smooth, flat, wide-range frequency response with electromagnetic hum shielding.",
		map[string]string{"Type": "Dynamic (Moving Coil)", "Polar Pattern": "Cardioid", "Frequency Response": "50 Hz to 20 kHz", "Connector": "Three-pin Professional XLR", "Weight": "765g"}, "USPS"),
	newProduct("prod_14", "Sonos Era 300 Spatial Audio Speaker", "Sonos", "Audio & Sound", "SONOS-ERA300-WHT", 44900, 4.8, 480, 18,
		"https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=600&q=80",
		"Revolutionary acoustic design featuring six optimally positioned drivers all around the front, sides, and top to support Dolby Atmos Spatial Audio.",
		map[string]string{"Amplifiers": "6 Class-D Digital Amps", "Spatial Audio": "Dolby Atmos Supported", "Connectivity": "Wi-Fi 6, Bluetooth 5.0, USB-C Line-In", "Microphones": "Far-field with Trueplay", "Weight": "4.47 kg"}, "UPS"),
	newProduct("prod_15", "Marshall Stanmore III Bluetooth Speaker", "Marshall", "Audio & Sound", "MARSH-STAN3-BLK", 37900, 4.8, 590, 21,
		"https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=600&q=80",
		"Legendary Marshall rock 'n' roll design with outward-angled tweeters, updated waveguides, Dynamic Loudness, and room-filling analog punch.",
		map[string]string{"Power": "80W Class D Amplification", "Frequency": "45–20,000 Hz", "Inputs": "Bluetooth 5.2, 3.5mm Aux, RCA", "Design": "PVC-free, 70% recycled plastic", "Weight": "4.25 kg"}, "FEDEX"),
	newProduct("prod_16", "Audio-Technica AT2020USB-X Cardioid Mic", "Audio-Technica", "Audio & Sound", "AT-2020USBX-MIC", 12900, 4.7, 810, 64,
		"https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=600&q=80",
		"High-resolution A/D converter with up to 24-bit/96 kHz sampling rate for crystal-clear studio reproduction, capacitive mute button, and headphone jack.",
		map[string]string{"Bit Depth": "24-bit / 96 kHz", "Output": "USB Type-C", "Monitoring": "Zero-latency Headphone Jack", "Pattern": "Cardioid Directional", "Weight": "373g"}, "USPS"),

	// ── 3. Gaming & VR Gear (8 products) ──
	newProduct("prod_17", "Sony PlayStation 5 Pro Console (2TB)", "Sony", "Gaming & VR", "PS5-PRO-2TB-ED", 69900, 4.9, 1890, 25,
		"https://images.unsplash.com/photo-1606813907291-d86efa9b94db?auto=format&fit=crop&w=600&q=80",
		"Upgraded GPU with PlayStation Spectral Super Resolution (PSSR) AI upscaling, advanced ray tracing, 60fps high-fidelity gameplay, and 2TB SSD.",
		map[string]string{"Storage": "2TB Ultra-High Speed SSD", "GPU": "67% More Compute Units", "Upscaling": "PSSR Machine Learning", "Output": "Supports 8K, 4K 120Hz, VRR", "Weight": "3.1 kg"}, "FEDEX"),
	newProduct("prod_18", "Meta Quest 3 Mixed Reality Headset (512GB)", "Meta", "Gaming & VR", "META-QUEST3-512GB", 49900, 4.8, 940, 33,
		"https://images.unsplash.com/photo-1622979135225-d2ba269bc1df?auto=format&fit=crop&w=600&q=80",
		"Breakthrough mixed reality with high-res full-color passthrough, Snapdragon XR2 Gen 2 processor, 4K+ Infinite Display, and Touch Plus controllers.",
		map[string]string{"Display": "2064x2208 pixels per eye", "Optics": "Pancake Lenses", "Processor": "Snapdragon XR2 Gen 2", "Audio": "3D Spatial Sound", "Weight": "515g"}, "UPS"),
	newProduct("prod_19", "Nintendo Switch OLED Model (White)", "Nintendo", "Gaming & VR", "NINT-SWITCH-OLED-W", 34900, 4.9, 3200, 58,
		"https://images.unsplash.com/photo-1578303512597-81e6cc155b3e?auto=format&fit=crop&w=600&q=80",
		"Vibrant 7-inch OLED screen, wide adjustable tabletop stand, dock with wired LAN port, 64GB internal storage, and enhanced onboard audio.",
		map[string]string{"Screen": "7.0-inch OLED (720p Handheld / 1080p TV)", "Storage": "64GB Internal + MicroSD", "Battery": "4.5 to 9 Hours", "Weight": "420g with Joy-Con"}, "USPS"),
	newProduct("prod_20", "Logitech G Pro X Superlight 2 Gaming Mouse", "Logitech", "Gaming & VR", "LOGI-GPROX-SL2-W", 15900, 4.9, 1450, 75,
		"https://images.unsplash.com/photo-1615663245857-ac93bb7c39e7?auto=format&fit=crop&w=600&q=80",
		"Ultralight 60g esports icon featuring LIGHTFORCE hybrid optical-mechanical switches, HERO 2 sensor with 32,000 DPI, and 95-hour battery life.",
		map[string]string{"Weight": "60 Grams", "Sensor": "HERO 2 32,000 DPI", "Polling Rate": "Up to 4,000 Hz", "Battery": "95 Hours Constant Motion", "Switches": "LIGHTFORCE Hybrid"}, "USPS"),
	newProduct("prod_21", "Razer BlackWidow V4 Pro Mechanical Keyboard", "Razer", "Gaming & VR", "RAZER-BW4-PRO-GRN", 22900, 4.7, 670, 36,
		"https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80",
		"Full battlestation immersion with Razer Command Dial, 8 dedicated macro keys, 8,000Hz hyperpolling, magnetic plush leatherette wrist rest, and Chroma RGB.",
		map[string]string{"Switches": "Razer Green Clicky Mechanical", "Polling": "8000 Hz HyperPolling", "Keycaps": "Doubleshot ABS", "Connectivity": "Detachable Dual USB-C", "Macros": "8 Dedicated Keys"}, "USPS"),
	newProduct("prod_22", "Steam Deck OLED (1TB Edition)", "Valve", "Gaming & VR", "VALVE-SDECK-1TB", 64900, 5.0, 1650, 20,
		"https://images.unsplash.com/photo-1612287233207-6c2e2c84e1b8?auto=format&fit=crop&w=600&q=80",
		"7.4-inch 90Hz HDR OLED display with custom 6nm AMD APU, Wi-Fi 6E, 50Wh battery offering 3–12 hours of gameplay, and premium anti-glare etched glass.",
		map[string]string{"Screen": "7.4-inch HDR OLED 90Hz", "APU": "6nm AMD Sephiroth", "RAM": "16 GB LPDDR5", "Storage": "1TB NVMe SSD", "Weight": "640g"}, "FEDEX"),
	newProduct("prod_23", "Xbox Wireless Controller (Carbon Black)", "Microsoft", "Gaming & VR", "MS-XBOX-CTRL-BLK", 5900, 4.8, 4100, 120,
		"https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?auto=format&fit=crop&w=600&q=80",
		"Modernized ergonomic design with sculpted surfaces, hybrid D-pad, textured grip on triggers and bumpers, and 3.5mm audio jack.",
		map[string]string{"Compatibility": "Xbox Series X|S, Xbox One, PC, Android, iOS", "Battery": "Up to 40 Hours (AA)", "Connectivity": "Xbox Wireless & Bluetooth", "Weight": "287g"}, "USPS"),
	newProduct("prod_24", "SteelSeries Arctis Nova Pro Wireless", "SteelSeries", "Gaming & VR", "STEEL-NOVA-PRO-WL", 34900, 4.8, 730, 27,
		"https://images.unsplash.com/photo-1599669454699-248893623440?auto=format&fit=crop&w=600&q=80",
		"Audiophile-grade Nova Pro Acoustic System with Active Noise Cancellation, Infinity Power System dual-battery hot swapping, and multi-system dual USB DAC.",
		map[string]string{"DAC": "Base Station with OLED Screen", "Battery": "Infinity Hot-Swap (Unlimited)", "ANC": "4-mic Hybrid Active NC", "Compatibility": "PC, Mac, PlayStation, Switch", "Weight": "338g"}, "USPS"),

	// ── 4. Computing & Laptops (6 products) ──
	newProduct("prod_25", "Apple MacBook Pro 16 M3 Max (36GB/1TB)", "Apple", "Computing & Laptops", "APPL-MBP16-M3MAX", 349900, 5.0, 512, 11,
		"https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80",
		"16-core CPU, 40-core GPU M3 Max chip with 16.2-inch Liquid Retina XDR display (1600 nits peak), 22 hours of battery life, and Space Black aluminum finish.",
		map[string]string{"Chip": "Apple M3 Max 16-Core", "Unified Memory": "36 GB", "Display": "16.2-inch Liquid Retina XDR 120Hz", "Storage": "1TB SSD", "Weight": "2.16 kg"}, "FEDEX"),
	newProduct("prod_26", "Dell XPS 15 OLED Laptop (i9/32GB/1TB)", "Dell", "Computing & Laptops", "DELL-XPS15-9530", 229900, 4.7, 380, 15,
		"https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=600&q=80",
		"13th Gen Intel Core i9-13900H with NVIDIA GeForce RTX 4070, 3.5K OLED InfinityEdge touch display, and CNC machined aluminum chassis.",
		map[string]string{"CPU": "Intel Core i9-13900H", "GPU": "NVIDIA RTX 4070 8GB", "RAM": "32GB DDR5 4800MHz", "Display": "15.6-inch 3.5K OLED Touch", "Weight": "1.92 kg"}, "UPS"),
	newProduct("prod_27", "Keychron Q1 Pro Wireless Custom Keyboard", "Keychron", "Computing & Laptops", "KEYCHRON-Q1PRO-KPB", 19900, 4.9, 890, 42,
		"https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=600&q=80",
		"75% layout QMK/VIA wireless mechanical keyboard with CNC machined aluminum body, double-gasket acoustic mount, hot-swappable sockets, and PBT keycaps.",
		map[string]string{"Body": "Full CNC 6063 Aluminum", "Connectivity": "Bluetooth 5.1 & Type-C", "Mount": "Double-Gasket Design", "Switches": "Keychron K Pro Red (Pre-Lubed)", "Weight": "1.74 kg"}, "USPS"),
	newProduct("prod_28", "LG 27MD5KL-B UltraFine 5K Display", "LG", "Computing & Laptops", "LG-27UF-5K-DISP", 129900, 4.6, 240, 10,
		"https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=600&q=80",
		"27-inch 5K (5120 x 2880) IPS display with 99% DCI-P3 wide color gamut, Thunderbolt 3 94W pass-through charging, and built-in camera/speakers.",
		map[string]string{"Resolution": "5120 x 2880 at 60Hz", "Panel": "IPS 500 nits Brightness", "Color": "99% DCI-P3", "Ports": "1x Thunderbolt 3, 3x USB-C", "Weight": "8.5 kg"}, "FEDEX"),
	newProduct("prod_29", "CalDigit TS4 Thunderbolt 4 Station (18 Ports)", "CalDigit", "Computing & Laptops", "CALDIGIT-TS4-DOCK", 39900, 4.9, 730, 35,
		"https://images.unsplash.com/photo-1544652478-6653e09f18a2?auto=format&fit=crop&w=600&q=80",
		"The ultimate 18-port docking hub with 98W Power Delivery, 2.5GbE ethernet, dual 6K 60Hz display support, and UHS-II SD/microSD slots.",
		map[string]string{"Ports": "18 Extreme Expansion Ports", "Charging": "98W Host Power Delivery", "Ethernet": "2.5 Gigabit LAN", "Display": "Up to Single 8K or Dual 6K", "Chassis": "Solid Aluminum"}, "USPS"),
	newProduct("prod_30", "Samsung 4TB 990 PRO NVMe SSD Heatsink", "Samsung", "Computing & Laptops", "SAMS-990PRO-4TB", 34900, 4.9, 1420, 50,
		"https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=600&q=80",
		"Top-tier PCIe Gen 4.0 x4 internal solid state drive with up to 7,450 MB/s read, custom thermal heatsink, and smart power efficiency.",
		map[string]string{"Capacity": "4 Terabytes", "Seq Read": "7,450 MB/s", "Seq Write": "6,900 MB/s", "Interface": "PCIe 4.0 NVMe 2.0", "Compatibility": "PC & PS5 Direct"}, "USPS"),

	// ── 5. Smart Home & IoT (8 products) ──
	newProduct("prod_31", "Smart IoT Matter Multi-Protocol Home Hub", "HomePilot", "Smart Home & IoT", "IOT-HUB-MATTER-01", 14900, 4.8, 530, 48,
		"https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=600&q=80",
		"Universal smart controller running Matter, Thread, Zigbee 3.0, and Z-Wave protocols with local automation execution and zero cloud lag.",
		map[string]string{"Protocols": "Matter, Thread, Zigbee, Z-Wave, Wi-Fi", "Storage": "32GB Local Flash", "Security": "Hardware Secure Enclave", "Power": "PoE or USB-C 5V"}, "USPS"),
	newProduct("prod_32", "Google Nest Learning Thermostat (4th Gen)", "Google", "Smart Home & IoT", "GOOG-NEST-T4-POL", 27900, 4.7, 1240, 35,
		"https://images.unsplash.com/photo-1563245372-f21724e3856d?auto=format&fit=crop&w=600&q=80",
		"Domed liquid glass display, dynamic borderless UI, Smart Schedule learning, and Matter compatibility to save an average of 15% on energy bills.",
		map[string]string{"Display": "High-Res Borderless Domed Glass", "Sensors": "Temperature, Humidity, Proximity", "Compatibility": "98% of HVAC Systems", "Support": "Matter & Google Home"}, "USPS"),
	newProduct("prod_33", "Philips Hue Smart Lighting Starter Kit (4-Pack)", "Philips Hue", "Smart Home & IoT", "PHIL-HUE-STARTER4", 19900, 4.9, 2400, 60,
		"https://images.unsplash.com/photo-1550524514-9b6d859b4c02?auto=format&fit=crop&w=600&q=80",
		"Four White and Color Ambiance A19 bulbs, Hue Bridge, and smart button. 16 million colors, automated sunrise routines, and dynamic music sync.",
		map[string]string{"Bulbs": "4x E26 1100 Lumen (75W Equivalent)", "Colors": "16 Million Colors + Tunable White", "Bridge": "Hue Bridge Hub Included", "Protocol": "Zigbee & Bluetooth"}, "USPS"),
	newProduct("prod_34", "Ring Video Doorbell Pro 2 (Hardwired)", "Ring", "Smart Home & IoT", "RING-VDB-PRO2", 24900, 4.6, 1670, 44,
		"https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=600&q=80",
		"1536p HD Head-to-Toe Video, 3D Motion Detection with radar-powered Bird's Eye View, Two-Way Talk with Audio+, and Alexa Greetings.",
		map[string]string{"Resolution": "1536p HD Head-to-Toe", "Radar": "3D Motion Detection", "Night Vision": "Color Night Vision", "Power": "Hardwired 16-24 VAC", "Connectivity": "Dual-Band 2.4/5GHz"}, "USPS"),
	newProduct("prod_35", "Roborock S8 MaxV Ultra Robot Vacuum", "Roborock", "Smart Home & IoT", "ROBO-S8MAXV-ULTRA", 179900, 4.9, 410, 9,
		"https://images.unsplash.com/photo-1518640467707-6811f4a6ab73?auto=format&fit=crop&w=600&q=80",
		"10,000 Pa extreme suction, FlexiArm side brush for zero dead corners, 60°C hot water mop washing, auto dirt detection, and built-in voice assistant.",
		map[string]string{"Suction": "10,000 Pa HyperForce", "Dock": "8-in-1 RockDock Ultra (Hot Water Wash)", "Mopping": "VibraRise 3.0 (4000x/min)", "Obstacle": "Reactive AI 2.0 Recognition"}, "FEDEX"),
	newProduct("prod_36", "Schlage Encode Plus Smart WiFi Deadbolt", "Schlage", "Smart Home & IoT", "SCHLAGE-ENC-PLUS-NK", 31900, 4.8, 820, 26,
		"https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=600&q=80",
		"Apple Home Key compatible smart lock. Tap your iPhone or Apple Watch to unlock with built-in Wi-Fi and Grade 1 commercial security certification.",
		map[string]string{"Security": "BHMA Grade 1 (Highest Rating)", "Home Key": "NFC Tap to Unlock with iPhone", "Connectivity": "Direct Wi-Fi & Thread", "Codes": "Up to 100 Access Codes"}, "USPS"),
	newProduct("prod_37", "Sonos Sub Mini Wireless Subwoofer", "Sonos", "Smart Home & IoT", "SONOS-SUB-MINI-BLK", 42900, 4.9, 530, 22,
		"https://images.unsplash.com/photo-1545454675-3531b543be5d?auto=format&fit=crop&w=600&q=80",
		"Dual custom force-cancelling woofers inside a sealed architectural cabinet neutralize distortion and generate deep, dynamic low-end bass.",
		map[string]string{"Woofers": "Dual 6-inch Inward Facing", "Amplifier": "Dual Class-D Digital", "Frequency": "Down to 25 Hz", "Wireless": "5 GHz Dedicated Ultra-Low Latency"}, "UPS"),
	newProduct("prod_38", "Nanoleaf Shapes Hexagons Smarter Kit (9 Panels)", "Nanoleaf", "Smart Home & IoT", "NANO-HEX-9PK", 19900, 4.7, 980, 37,
		"https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=600&q=80",
		"Modular ultra-thin smart LED light panels with Connect+ technology, music visualizer sync, screen mirror immersion, and touch control.",
		map[string]string{"Panels": "9 Hexagon Light Panels", "Luminance": "100 Lumens per Panel", "Color Range": "16M Colors & 1200K-6500K White", "Features": "Touch Reactive, Rhythm Sync"}, "USPS"),

	// ── 6. Wearables & Fitness (6 products) ──
	newProduct("prod_39", "Apple Watch Ultra 2 (Titanium/Ocean Band)", "Apple", "Wearables & Fitness", "APPL-WAT-ULTRA2-OCN", 79900, 4.9, 1420, 28,
		"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=600&q=80",
		"49mm aerospace-grade titanium case with S9 SiP, 3000-nit Always-On display, precision dual-frequency GPS, 36-hr battery life, and 100m water resistance.",
		map[string]string{"Case": "49mm Titanium", "Display": "3000 nits Sapphire Crystal", "Battery": "Up to 72 Hours in Low Power", "Depth": "100m Water / EN13319 Dive Certified"}, "USPS"),
	newProduct("prod_40", "Garmin Fenix 7 Pro Sapphire Solar (47mm)", "Garmin", "Wearables & Fitness", "GARM-FENIX7P-SOL", 79900, 4.9, 610, 19,
		"https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=600&q=80",
		"Multisport GPS watch with solar charging lens, built-in LED flashlight, endurance score, Hill score, and up to 22 days of battery life in smartwatch mode.",
		map[string]string{"Battery": "Up to 22 Days with Solar", "Glass": "Power Sapphire Solar", "Flashlight": "Variable White & Red LED", "Maps": "TopoActive Multi-Continent Preloaded"}, "UPS"),
	newProduct("prod_41", "Oura Ring Gen 3 Horizon (Stealth Black)", "Oura", "Wearables & Fitness", "OURA-R3-HOR-STL", 39900, 4.6, 890, 45,
		"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=600&q=80",
		"Titanium smart ring monitoring sleep stages, Readiness score, HRV, heart rate trends, and body temperature variations with zero screen distractions.",
		map[string]string{"Material": "Durable Lightweight Titanium", "Sensors": "Red & Green LEDs, Infrared PPG, Skin Temp", "Battery": "4 to 7 Days", "Waterproof": "Up to 100m (330 ft)"}, "USPS"),
	newProduct("prod_42", "Whoop 4.0 Fitness & Recovery Tracker", "Whoop", "Wearables & Fitness", "WHOOP-4-ONYX-KIT", 23900, 4.7, 1120, 50,
		"https://images.unsplash.com/photo-1576243345690-4e4b79b63288?auto=format&fit=crop&w=600&q=80",
		"Screenless 24/7 biometric sensor providing physiological Strain, Sleep Coach, and Recovery metrics with waterproof on-the-go wireless battery pack.",
		map[string]string{"Sensors": "5 LEDs (Green, Red, IR), 4 Photodiodes", "Battery": "Wireless Slide-on PowerPack", "Waterproof": "IP68 Submersible to 10m", "Subscription": "Includes 12-Month Access"}, "USPS"),
	newProduct("prod_43", "Samsung Galaxy Watch Ultra (47mm LTE)", "Samsung", "Wearables & Fitness", "SAMS-GW-ULTRA-LTE", 64900, 4.8, 480, 22,
		"https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=600&q=80",
		"Grade 4 Titanium cushion frame, 3nm processor with Galaxy AI health insights, dual-frequency GPS, Emergency Siren, and 10 ATM ocean durability.",
		map[string]string{"Case": "Grade 4 Titanium (47mm)", "Processor": "3nm Exynos W1000", "Sensors": "BioActive 13-LED Multi-Sensor", "Battery": "Up to 100 Hours (Power Saving)"}, "USPS"),
	newProduct("prod_44", "Polar H10 Heart Rate Sensor Chest Strap", "Polar", "Wearables & Fitness", "POLAR-H10-STRAP-M", 8900, 4.9, 2300, 90,
		"https://images.unsplash.com/photo-1510519138161-58474dfab9c8?auto=format&fit=crop&w=600&q=80",
		"The gold standard for ECG heart rate accuracy. Dual simultaneous Bluetooth connections, ANT+, onboard training session memory, and 400-hr battery.",
		map[string]string{"Measurement": "Medical Grade ECG Electrodes", "Battery": "400 Hours (Coin Cell CR2025)", "Connectivity": "Dual Bluetooth Low Energy & ANT+", "Waterproof": "30m"}, "USPS"),

	// ── 7. Mobile & Tablets (4 products) ──
	newProduct("prod_45", "Apple iPad Pro 13 M4 (256GB Wi-Fi Space Black)", "Apple", "Mobile & Tablets", "APPL-IPADPRO13-M4", 129900, 4.9, 620, 18,
		"https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?auto=format&fit=crop&w=600&q=80",
		"Ultra Retina XDR Tandem OLED display (1600 nits HDR), groundbreaking M4 chip with Next-Gen Neural Engine, and impossibly thin 5.1mm chassis.",
		map[string]string{"Screen": "13-inch Tandem OLED 120Hz", "Chip": "Apple M4 9-Core", "Thickness": "5.1mm (Thinnest Apple Product)", "Cameras": "12MP Wide + LiDAR Scanner", "Weight": "579g"}, "FEDEX"),
	newProduct("prod_46", "Samsung Galaxy S24 Ultra (512GB Titanium Black)", "Samsung", "Mobile & Tablets", "SAMS-S24U-512GB", 141900, 4.8, 1430, 25,
		"https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=600&q=80",
		"Titanium exterior with 200MP Quad Tele camera system, flat 6.8-inch Dynamic AMOLED 2X with Corning Gorilla Armor anti-reflective glass, and S Pen.",
		map[string]string{"Main Camera": "200MP f/1.7 OIS", "Processor": "Snapdragon 8 Gen 3 for Galaxy", "Display": "6.8-inch QHD+ 2600 nits", "Pen": "Embedded S Pen Included"}, "UPS"),
	newProduct("prod_47", "reMarkable 2 Paper Tablet with Marker Plus", "reMarkable", "Mobile & Tablets", "REMARK-2-BUNDLE", 44900, 4.7, 850, 30,
		"https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80",
		"The world's thinnest digital notebook at 4.7mm. CANVAS monochrome display feels like real paper for distraction-free note-taking and PDF reading.",
		map[string]string{"Thickness": "4.7mm", "Display": "10.3-inch CANVAS E-Ink Paper", "Battery": "Up to 2 Weeks Active Use", "Marker": "Marker Plus with Built-In Eraser"}, "USPS"),
	newProduct("prod_48", "Anker Prime 27,650mAh Power Bank (250W)", "Anker", "Mobile & Tablets", "ANKER-PRIME-250W-PB", 17900, 4.9, 1290, 55,
		"https://images.unsplash.com/photo-1609592424364-f6b0f4886650?auto=format&fit=crop&w=600&q=80",
		"Massive 27,650mAh capacity with 250W multi-port fast charging, smart digital display showing live wattages, and airline-approved TSA sizing.",
		map[string]string{"Capacity": "27,650mAh (99.54Wh TSA Compliant)", "Max Output": "250W (140W Single Port PD 3.1)", "Ports": "2x USB-C, 1x USB-A", "Screen": "Full Color Smart Display"}, "USPS"),

	// ── 8. Creator & Studio Gear (4 products) ──
	newProduct("prod_49", "Elgato Stream Deck XL (32 Macro Keys)", "Elgato", "Creator & Studio", "ELGATO-SDECK-XL", 24900, 4.9, 2210, 45,
		"https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80",
		"32 customizable LCD keys with instant tactile feedback. Trigger studio actions, control OBS, launch media, adjust audio, and integrate Smart Home.",
		map[string]string{"Keys": "32 Customizable LCD Keys", "Interface": "USB 3.0 Type-C", "Stand": "Magnetic Anti-Slip Desktop Stand", "Software": "Stream Deck Plugin Store Compatible"}, "USPS"),
	newProduct("prod_50", "RØDECaster Pro II Audio Production Studio", "RØDE", "Creator & Studio", "RODE-CASTER-PRO2", 69900, 4.9, 490, 14,
		"https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=600&q=80",
		"Ultra-low-noise Revolution PreAmps, quad combo XLR inputs, onboard APHEX audio processing, dual USB-C interfaces, and SMART pads.",
		map[string]string{"PreAmps": "Ultra-Low-Noise Revolution (-131.5dBV EIN)", "Inputs": "4x Neutrik Combo XLR/Line", "Pads": "8 SMART Customizable Sound Pads", "Touchscreen": "5.5-inch High-Definition Haptic"}, "FEDEX"),
	newProduct("prod_51", "Nanlite Forza 60B II Bi-Color LED Monolight", "Nanlite", "Creator & Studio", "NANLITE-FORZA-60B2", 31900, 4.8, 280, 22,
		"https://images.unsplash.com/photo-1513506003901-1e6a229e2d15?auto=format&fit=crop&w=600&q=80",
		"Ultra-compact bi-color studio spotlight with 2700K–6500K CCT range, ultra-quiet fan, Bowens adapter included, and 14,350 lux at 1 meter.",
		map[string]string{"Output": "14,350 Lux at 1m with Reflector", "CCT Range": "2700K - 6500K Bi-Color", "Color Accuracy": "CRI 96, TLCI 98", "Power": "AC Adapter or Dual NP-F/V-Mount Batteries"}, "UPS"),
	newProduct("prod_52", "Sony ZV-E1 Full-Frame Vlogging Camera", "Sony", "Creator & Studio", "SONY-ZVE1-BLK", 219800, 4.8, 360, 15,
		"https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=600&q=80",
		"12.1MP full-frame sensor designed specifically for content creators. AI auto-framing, dynamic active mode stabilization, and 4K 120p recording.",
		map[string]string{"Sensor": "12.1MP Full-Frame Exmor R", "AI Features": "Auto-Framing, Framing Stabilizer, Multiple Face Recognition", "Audio": "Intelligent 3-Capsule Directional Mic", "Weight": "483g"}, "FEDEX"),
}

// Products returns the demo storefront catalog.
func Products() []map[string]any {
	out := make([]map[string]any, 0, len(catalog))
	for _, p := range catalog {
		out = append(out, map[string]any{
			"id":              p.ID,
			"name":            p.Name,
			"brand":           p.Brand,
			"category":        p.Category,
			"sku":             p.SKU,
			"price_cents":     p.PriceCents,
			"rating":          p.Rating,
			"reviews_count":   p.ReviewsCount,
			"stock":           p.Stock,
			"image_url":       p.ImageURL,
			"description":     p.Description,
			"specs":           p.Specs,
			"carrier_default": p.CarrierDefault,
		})
	}
	return out
}

// findProduct looks up a catalog entry by SKU.
func findProduct(sku string) *product {
	for i := range catalog {
		if catalog[i].SKU == sku {
			return &catalog[i]
		}
	}
	return nil
}
