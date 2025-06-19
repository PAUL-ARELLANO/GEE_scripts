Google Earth Engine Script: Annual NDVI Analysis and Trend
This script performs a comprehensive analysis of vegetation health using the Normalized Difference Vegetation Index (NDVI) derived from Sentinel-2 satellite imagery. It focuses on a user-defined study area, calculates annual NDVI composites for specific seasons, analyzes trends over time, and exports the results.

Script Breakdown:
1. Setup: Import Polygons and Define Study Area

Polygon Import: The script begins by importing a FeatureCollection of polygons, which define the specific areas of interest.
javascript
// var polygons = ee.FeatureCollection("projects/paul-gee/assets/Priority2");
// var polygons = ee.FeatureCollection("projects/paul-gee/assets/Priority_3_WGS84_Arizona_cleaned_north");
var polygons = ee.FeatureCollection("projects/paul-gee/assets/Priority_3_WGS84_Arizona_cleaned_south_2");
You'll need to uncomment the line corresponding to your desired polygon asset or update the path to your specific asset.
Study Area Definition: The studyArea is defined as the geometric union of all imported polygons. This ensures that all subsequent analyses are confined to these areas.
Map Visualization: The map view is centered on the polygons, and the polygons are added as a red layer for visual reference.
2. Diagnostic: Raw Data Availability Check (2023)

This section performs a quick check to see if any Sentinel-2 SR (Surface Reflectance, Harmonized) data is available for the studyArea for the entire year 2023, without any cloud filtering.
It prints the total count of raw images found.
If images are found, the first raw image is clipped to the studyArea and displayed on the map using true-color bands (B4, B3, B2) to give an initial sense of data presence and potential cloud/haze conditions.
A warning is printed if no raw images are found, which could indicate issues with the study area definition or data availability for the specified period.
3. Data Filtering and Cloud Masking (Sentinel-2)

Image Collection: It loads the Sentinel-2 SR Harmonized image collection (COPERNICUS/S2_SR_HARMONIZED).
Initial Filters:
filterBounds(studyArea): Filters the collection to include only images that intersect the studyArea.
filterDate('2023-01-01', '2025-12-31'): Filters images for a broad date range (2023-2025) to capture data for the annual analysis.
filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 80)): This line is commented out. If active, it would filter out images with more than 80% cloud cover.
Cloud Masking Function (Commented Out):
A function maskS2clouds is defined but currently commented out. This function was intended to:
Use the QA60 band to mask out opaque and cirrus clouds.
Use the SCL (Scene Classification Layer) band to mask out additional cloud types (cirrus, saturated/defective pixels). Potentially, it could also mask cloud shadows and different cloud probabilities, but these are also commented out within the function.
Select specific bands (B8, B4, B2, B3, B11, B12) and scale their values by dividing by 10000 (common for Sentinel-2 SR data).
If this section were active, the sentinel2 collection would be mapped over this function to apply the mask.
Collection Size Prints: The script prints the size of the Sentinel-2 collection before and after the (currently inactive) masking step.
Inspect First Masked Image:
It attempts to retrieve the first image from the (potentially masked) sentinel2 collection.
If an image exists, it's clipped to the studyArea and displayed on the map in RGB and NIR (Near-Infrared) for visual inspection.
4. Compute NDVI

NDVI Function: A function computeNDVI is defined to calculate the Normalized Difference Vegetation Index using the formula: NDVI = (NIR - Red) / (NIR + Red). For Sentinel-2, this translates to (B8 - B4) / (B8 + B4).
The calculated NDVI band is added to each image in the sentinel2 collection, creating ndviCollection.
Inspect First NDVI Image: The first NDVI image from the collection is clipped and displayed on the map using a red-yellow-green color palette.
5. Compute Annual NDVI Composites (Spring/Summer)

Years: Defines a list of years for analysis (2023, 2024, 2025).
Yearly Mapping: The script iterates through each year to create an annual NDVI composite.
Seasonal Filter: For each year, it filters the ndviCollection for a specific "Spring/Summer" period (March 1st to June 17th).
Median Composite: It calculates the median NDVI value for all images within that year's Spring/Summer window. The median is a robust way to create a cloud-free or less cloudy composite.
Robustness Checks & Default Image:
It creates a defaultImage (an image of constant 0s) to use if no valid data is found for a given year's composite.
It checks if the composite image actually has bands (i.e., if it was successfully created).
It then checks if the baseImage (either the composite or the default) has unmasked pixels within the studyArea.
The finalResultImage is set to the baseImage if it has data, otherwise, it's set to the defaultImage. This ensures that an image is always produced for each year, even if it's just an image of zeros.
Metadata: Each annual composite image is set with properties like the year, system:time_start, system:time_end, num_images_in_composite, and flags indicating data presence.
The result is an ImageCollection named yearlyNDVI containing one NDVI composite image per year.
6. Visualization of Yearly Composites

The script filters the yearlyNDVI collection for each year (2023, 2024, 2025) and adds the resulting composite NDVI image to the map using the defined vizParams (red-yellow-green palette).
It prints information about each composite image for inspection.
7. Compute NDVI Trend

Linear Fit: This section calculates the linear trend of NDVI values over the years.
It maps over the yearlyNDVI collection. For each image:
It creates an 'x' band representing the year (time).
It takes the 'NDVI' band as the 'y' band.
It then applies ee.Reducer.linearFit() to this multi-band collection. This reducer calculates the slope and offset of the best-fit linear regression line through the NDVI values over time. The 'scale' band in the output represents the slope (trend), and 'offset' represents the intercept.
Clipping and Default: The resulting ndviTrend image (containing 'scale' and 'offset' bands) is clipped to the studyArea. If the trend calculation fails or doesn't produce a 'scale' band, a default image of 0s is used.
Visualization: The 'scale' band (slope) of the trend is added to the map, visualized with a blue-white-green palette (blue for negative trend, green for positive trend).
8. Extract NDVI Per Polygon (Mean Statistics)

This section calculates the mean NDVI value for each individual polygon within the polygons FeatureCollection for each annual composite.
It maps over the yearlyNDVI collection. For each annual NDVI image:
reduceRegions() is used to calculate the mean NDVI within each feature (polygon) of the polygons collection.
The year property is added to each resulting feature.
flatten() is used to combine the FeatureCollections from each year into a single FeatureCollection (ndviStats). Each feature in ndviStats will represent a polygon for a specific year and will have a mean NDVI property.
9. NDVI Trend Plot (Time-Series Chart)

A time-series chart is generated to visualize the mean NDVI trend over time for the entire studyArea.
ui.Chart.image.series is used with:
imageCollection: The yearlyNDVI collection (selecting only the 'NDVI' band).
region: The geometry of all polygons combined (polygons.geometry()).
reducer: ee.Reducer.mean() to calculate the average NDVI across the region.
scale: 30 meters (Sentinel-2 resolution).
xProperty: 'system:time_start' to plot against time.
The chart is configured with a title and axis labels and then printed to the console.
10. Export NDVI Results as GeoTIFFs - Annual NDVI Composites: - An exportNDVI function is defined to export each annual Spring/Summer NDVI composite. - It checks if the image for the given year exists and has an 'NDVI' band before attempting export. - Export.image.toDrive is used to save the 'NDVI' band of each yearly composite as a GeoTIFF to Google Drive. - Files are named NDVI_SpringSummer_[year].tif. - The export uses the studyArea.bounds() for the region, a scale of 30 meters, and CRS EPSG:4326. - The yearsList ([2023, 2024, 2025]) is iterated to export each year's composite. - NDVI Trend Slope: - If the ndviTrend image is valid and contains the 'scale' band (slope), it is exported to Google Drive. - The file is named NDVI_Trend_Slope_SpringSummer.tif. - Export parameters are similar to the annual composites. - Warnings are printed if exports are skipped due to missing data or bands.

Key Features:
Data Source: Sentinel-2 SR Harmonized imagery.
Vegetation Index: Normalized Difference Vegetation Index (NDVI).
Area of Interest: User-defined polygons.
Temporal Analysis:
Annual median NDVI composites for a specific season (Spring/Summer: March 1st - June 17th).
Linear trend analysis of NDVI over the specified years.
Robustness: Includes checks for data availability and valid image bands before processing and visualization, with fallbacks to default (zero) images.
Outputs:
Map layers for polygons, raw S2 image, (masked) S2 image, first NDVI image, annual NDVI composites, and NDVI trend slope.
Console prints for collection sizes, image properties, and statistics.
Time-series chart of mean NDVI for the study area.
GeoTIFF exports to Google Drive for:
Annual Spring/Summer NDVI composites (e.g., NDVI_SpringSummer_2023.tif).
NDVI trend slope (NDVI_Trend_Slope_SpringSummer.tif).
How to Use:
Define Polygons: Ensure the ee.FeatureCollection path for polygons (in Section 1) points to your asset in Google Earth Engine. Uncomment the correct line or provide your own asset ID.
Adjust Years/Dates (Optional):
Modify the years list in Section 4 if you want to analyze different years.
Adjust the springSummerStartDate and springSummerEndDate in Section 4 if you need to change the seasonal window for the composites.
Update the overall date filter in Section 2 (.filterDate('2023-01-01', '2025-12-31')) if your analysis period changes significantly.
Cloud Masking (Optional):
The cloud masking function (maskS2clouds) and its application are currently commented out. If you wish to use cloud masking, you will need to:
Uncomment the maskS2clouds function definition.
Uncomment the line sentinel2 = sentinel2.map(maskS2clouds);.
Review and potentially adjust the cloud/shadow masking parameters within the maskS2clouds function based on your needs and imagery conditions.
Run the Script: Execute the script in the Google Earth Engine Code Editor.
Check Outputs:
View layers on the map.
Inspect printed information in the Console.
Check your Google Drive for the exported GeoTIFF files (Tasks tab in GEE will show export progress).
Potential Improvements/Considerations:
Activate and Refine Cloud Masking: The current cloud masking is disabled. Enabling and fine-tuning it (especially the SCL band usage) could improve the quality of the NDVI composites by reducing cloud contamination.
Seasonal Definition: The "Spring/Summer" window is fixed. This could be made more dynamic or adjusted based on regional phenology.
Alternative Compositing: While median is robust, other methods like mean, max NDVI, or quality-based mosaicking (e.g., using a cloud score) could be explored.
Statistical Significance of Trend: The script calculates the trend slope but doesn't assess its statistical significance (e.g., p-value).
Error Handling for Exports: More sophisticated error handling could be added for the export tasks.
Parameterization: Key parameters (like dates, cloud thresholds, asset paths) could be defined at the top of the script for easier modification.
