export const DOWNLOAD_RESPONSE_HEADERS_FUNCTION_CODE = String.raw`
function handler(event) {
  var query = event.request.querystring || {};
  var response = event.response;
  var download = query.download && query.download.value === "1";
  var name = query.filename && query.filename.value
    ? query.filename.value
    : "";

  for (var decodePass = 0; decodePass < 2 && name.indexOf("%") !== -1; decodePass += 1) {
    try {
      var decodedName = decodeURIComponent(name);
      if (decodedName === name) break;
      name = decodedName;
    } catch (error) {
      name = "";
      break;
    }
  }

  var validName = name.length > 4
    && name.length <= 84
    && /\.mp4$/i.test(name)
    && !/[\x00-\x1f\x7f-\x9f\\/:";<>|?*]/.test(name);

  if (download || validName) {
    var disposition = (download ? "attachment" : "inline")
      + "; filename=\"short.mp4\"";
    if (validName) {
      var encodedName = encodeURIComponent(name).replace(/[!'()*]/g, function (character) {
        return "%" + character.charCodeAt(0).toString(16).toUpperCase();
      });
      disposition += "; filename*=UTF-8''" + encodedName;
    }
    response.headers["content-disposition"] = { value: disposition };
    response.headers["cache-control"] = { value: "private, no-store, max-age=0" };
    response.headers["x-content-type-options"] = { value: "nosniff" };
  }
  return response;
}`.trim();
