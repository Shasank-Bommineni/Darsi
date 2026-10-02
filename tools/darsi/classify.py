"""Road, building and land classification rules for Darsi.

The numbers here are reference-based: they encode what a small town in coastal
Andhra Pradesh actually looks like (carriageway widths, storey heights, compound
wall heights) rather than European defaults.  Sources used as *reference only*
are listed in docs/data-sources.md.
"""
from __future__ import annotations

# ---------------------------------------------------------------- roads
# width  = paved carriageway width in metres (both directions together)
# shoulder = unpaved/earth shoulder on EACH side
# base_quality = 0 (broken earth) .. 1 (fresh asphalt); the builder perturbs it
# speed = advisory free-flow speed in km/h used by the traffic system
ROAD_CLASSES = {
    "highway": dict(width=10.0, shoulder=2.6, base_quality=0.80, speed=70, lanes=2, markings="centre_dashed", surface="asphalt"),
    "arterial": dict(width=8.4, shoulder=2.2, base_quality=0.74, speed=60, lanes=2, markings="centre_dashed", surface="asphalt"),
    "major": dict(width=7.0, shoulder=1.8, base_quality=0.66, speed=50, lanes=2, markings="centre_dashed", surface="asphalt"),
    "secondary": dict(width=6.0, shoulder=1.4, base_quality=0.58, speed=40, lanes=2, markings="centre_faded", surface="asphalt"),
    "townroad": dict(width=5.4, shoulder=1.1, base_quality=0.52, speed=35, lanes=2, markings="none", surface="asphalt"),
    "bazaar": dict(width=6.2, shoulder=0.8, base_quality=0.46, speed=20, lanes=2, markings="none", surface="asphalt"),
    "residential": dict(width=4.4, shoulder=0.8, base_quality=0.44, speed=25, lanes=1, markings="none", surface="asphalt"),
    "lane": dict(width=3.2, shoulder=0.5, base_quality=0.34, speed=18, lanes=1, markings="none", surface="concrete"),
    "farm": dict(width=3.0, shoulder=0.6, base_quality=0.14, speed=18, lanes=1, markings="none", surface="dirt"),
    "path": dict(width=1.8, shoulder=0.3, base_quality=0.10, speed=10, lanes=1, markings="none", surface="dirt"),
}

HIGHWAY_TO_CLASS = {
    "motorway": "highway",
    "motorway_link": "arterial",
    "trunk": "highway",
    "trunk_link": "arterial",
    "primary": "arterial",
    "primary_link": "major",
    "secondary": "major",
    "secondary_link": "secondary",
    "tertiary": "secondary",
    "tertiary_link": "townroad",
    "unclassified": "townroad",
    "residential": "residential",
    "living_street": "lane",
    "pedestrian": "bazaar",
    "service": "lane",
    "track": "farm",
    "path": "path",
    "footway": "path",
    "bridleway": "path",
    "cycleway": "path",
    "road": "townroad",
}

SURFACE_QUALITY = {
    "asphalt": 0.82,
    "paved": 0.74,
    "concrete": 0.70,
    "concrete:plates": 0.60,
    "paving_stones": 0.62,
    "chipseal": 0.66,
    "compacted": 0.38,
    "fine_gravel": 0.32,
    "gravel": 0.26,
    "unpaved": 0.22,
    "ground": 0.16,
    "dirt": 0.14,
    "earth": 0.14,
    "sand": 0.12,
    "grass": 0.10,
}

SURFACE_KIND = {
    "asphalt": "asphalt",
    "paved": "asphalt",
    "chipseal": "asphalt",
    "concrete": "concrete",
    "concrete:plates": "concrete",
    "paving_stones": "concrete",
    "compacted": "gravel",
    "fine_gravel": "gravel",
    "gravel": "gravel",
    "unpaved": "dirt",
    "ground": "dirt",
    "dirt": "dirt",
    "earth": "dirt",
    "sand": "dirt",
    "grass": "dirt",
}


def classify_road(tags: dict) -> str | None:
    hw = tags.get("highway")
    if hw == "construction":
        hw = tags.get("construction") or "unclassified"
    if hw is None:
        return None
    if hw in ("steps", "corridor", "elevator", "proposed", "platform", "bus_stop", "street_lamp", "crossing", "traffic_signals", "turning_circle", "give_way", "stop", "milestone", "speed_camera"):
        return None
    return HIGHWAY_TO_CLASS.get(hw)


# ---------------------------------------------------------------- buildings
# Each category drives the procedural facade generator in the game.
BUILDING_CATEGORIES = (
    "hut",              # thatch / tin / mud, single room
    "house_small",      # one-storey RCC or brick house, narrow frontage
    "house",            # standard one-storey independent house
    "house_large",      # bigger plot, parapet, terrace, tank
    "house_two",        # two-storey family home
    "apartment",        # 3+ storeys
    "shop",             # ground floor commercial shutter
    "shophouse",        # shop below, residence above
    "commercial",       # standalone commercial / bank / showroom
    "school",
    "hospital",
    "government",
    "temple",
    "mosque",
    "church",
    "shed",             # tin roof utility structure
    "warehouse",
    "industrial",
    "unfinished",       # bare RCC frame, exposed rebar
    "water_tank",
    "civic",            # bus station, community hall
)

AMENITY_CATEGORY = {
    "school": "school",
    "college": "school",
    "university": "school",
    "kindergarten": "school",
    "hospital": "hospital",
    "clinic": "hospital",
    "doctors": "hospital",
    "pharmacy": "shop",
    "police": "government",
    "fire_station": "government",
    "townhall": "government",
    "courthouse": "government",
    "post_office": "government",
    "bank": "commercial",
    "atm": "shop",
    "fuel": "commercial",
    "bus_station": "civic",
    "marketplace": "bazaar",
    "community_centre": "civic",
    "library": "civic",
    "cinema": "civic",
    "theatre": "civic",
    "restaurant": "shop",
    "cafe": "shop",
    "fast_food": "shop",
    "place_of_worship": "temple",
}

RELIGION_CATEGORY = {
    "hindu": "temple",
    "muslim": "mosque",
    "christian": "church",
    "sikh": "temple",
    "jain": "temple",
    "buddhist": "temple",
}

BUILDING_TAG_CATEGORY = {
    "house": "house",
    "detached": "house",
    "residential": "house",
    "bungalow": "house",
    "semidetached_house": "house_small",
    "terrace": "house_small",
    "hut": "hut",
    "cabin": "hut",
    "apartments": "apartment",
    "dormitory": "apartment",
    "commercial": "commercial",
    "retail": "shop",
    "kiosk": "shop",
    "supermarket": "shop",
    "office": "commercial",
    "school": "school",
    "college": "school",
    "university": "school",
    "kindergarten": "school",
    "hospital": "hospital",
    "government": "government",
    "civic": "civic",
    "public": "civic",
    "train_station": "civic",
    "temple": "temple",
    "mosque": "mosque",
    "church": "church",
    "chapel": "church",
    "shrine": "temple",
    "cathedral": "church",
    "religious": "temple",
    "warehouse": "warehouse",
    "industrial": "industrial",
    "factory": "industrial",
    "shed": "shed",
    "garage": "shed",
    "garages": "shed",
    "roof": "shed",
    "hangar": "warehouse",
    "farm_auxiliary": "shed",
    "barn": "shed",
    "greenhouse": "shed",
    "construction": "unfinished",
    "water_tower": "water_tank",
    "storage_tank": "water_tank",
    "service": "shed",
    "toilets": "shed",
}

# Typical storey height in metres for small-town Andhra construction.
STOREY_H = {
    "hut": 2.6,
    "shed": 3.0,
    "house_small": 3.1,
    "house": 3.3,
    "house_large": 3.5,
    "house_two": 3.3,
    "apartment": 3.2,
    "shop": 3.8,
    "shophouse": 3.5,
    "commercial": 3.8,
    "school": 3.6,
    "hospital": 3.6,
    "government": 3.7,
    "civic": 4.2,
    "warehouse": 6.0,
    "industrial": 6.5,
    "unfinished": 3.2,
    "temple": 4.0,
    "mosque": 4.5,
    "church": 5.0,
    "water_tank": 12.0,
}


def classify_building(tags: dict) -> str | None:
    b = tags.get("building") or tags.get("building:part")
    amenity = tags.get("amenity")
    religion = tags.get("religion")
    man_made = tags.get("man_made")
    shop = tags.get("shop")

    if man_made in ("water_tower", "storage_tank", "reservoir_covered"):
        return "water_tank"
    if amenity == "place_of_worship" or tags.get("building") in ("temple", "mosque", "church", "shrine"):
        cat = RELIGION_CATEGORY.get(religion or "", None)
        if cat:
            return cat
        return BUILDING_TAG_CATEGORY.get(str(b), "temple")
    if amenity and amenity in AMENITY_CATEGORY:
        c = AMENITY_CATEGORY[amenity]
        return "shop" if c == "bazaar" else c
    if shop:
        return "shop"
    if tags.get("office"):
        return "commercial"
    if tags.get("healthcare"):
        return "hospital"
    if b and b != "yes":
        return BUILDING_TAG_CATEGORY.get(b, "house")
    if b == "yes":
        return None  # resolved later from size/context
    return None


# ---------------------------------------------------------------- ground cover
# ground material ids understood by the terrain shader
GROUND_DRY_EARTH = 0
GROUND_FIELD = 1
GROUND_SCRUB = 2
GROUND_TOWN = 3
GROUND_WATER_BED = 4
GROUND_GRASS = 5

LANDUSE_GROUND = {
    "farmland": GROUND_FIELD,
    "farmyard": GROUND_DRY_EARTH,
    "orchard": GROUND_FIELD,
    "vineyard": GROUND_FIELD,
    "meadow": GROUND_GRASS,
    "grass": GROUND_GRASS,
    "village_green": GROUND_GRASS,
    "recreation_ground": GROUND_GRASS,
    "residential": GROUND_TOWN,
    "commercial": GROUND_TOWN,
    "retail": GROUND_TOWN,
    "industrial": GROUND_DRY_EARTH,
    "cemetery": GROUND_SCRUB,
    "quarry": GROUND_DRY_EARTH,
    "brownfield": GROUND_DRY_EARTH,
    "greenfield": GROUND_SCRUB,
    "forest": GROUND_SCRUB,
    "scrub": GROUND_SCRUB,
}

NATURAL_GROUND = {
    "scrub": GROUND_SCRUB,
    "grassland": GROUND_GRASS,
    "wood": GROUND_SCRUB,
    "heath": GROUND_SCRUB,
    "sand": GROUND_DRY_EARTH,
    "bare_rock": GROUND_DRY_EARTH,
    "water": GROUND_WATER_BED,
    "wetland": GROUND_GRASS,
}
