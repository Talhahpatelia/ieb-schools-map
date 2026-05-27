# Cool IEB MAP

## Get data

The value passed to the file is the Cookies session code

```py
python .\getCountriesNice.py "<COOKIE SESSION>"
```

Save the ouput .json file in the public folder under the name `schools.json`.

## Geocode school locations

Set a Google Places API key in your shell, then run:

```sh
yarn geocode:places --output=public/schools-geocoded.json --delay-ms=120 --max-results=3 --api-version=legacy
```

The app will use `schools-geocoded.json` when it exists, and fall back to `schools.json` when it does not.


## Run the app

```sh
yarn start
```
