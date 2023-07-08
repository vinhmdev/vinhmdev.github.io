const infoProduct = {};
var urlBaseApi = 'https://cds-home-default-rtdb.firebaseio.com/default.json';
const package = new URLSearchParams(window.location.search).get('dev');
if (package != null) {
    if (package.startsWith('http')) {
        urlBaseApi = package;
    }
    else {
        urlBaseApi = urlBaseApi.replaceAll('/default.json', `/${package}.json`);
    }
}

function showProduct(productInfoId) {
    const prod = infoProduct[productInfoId];
    const dialogProductName = document.getElementById('div-dialog-name');
    const dialogThubnail = document.getElementById('div-dialog-thubnail');
    const dialogDescription = document.getElementById('div-dialog-description');
    const dialogUrl = document.getElementById('div-dialog-url');

    dialogProductName.innerText = prod['title'];
    dialogDescription.innerText = prod['description'];
    dialogThubnail.setAttribute('src', prod['thumbnail'])
    dialogUrl.setAttribute('href', prod['url']);

    openDialog();
}

function hotspotProduct(hotSpotDiv, args) {
    const idProduct = `${args['id']}`;
    infoProduct[idProduct] = args;
    hotSpotDiv.setAttribute('onclick', `showProduct("${idProduct}")`);
    hotSpotDiv.classList.add('custom-tooltip');

    var span = document.createElement('span');
    span.innerHTML = args['text'] ?? 'Xem chi tiết';
    hotSpotDiv.appendChild(span);
    span.style.width = span.scrollWidth - 20 + 'px';
    span.style.marginLeft = -(span.scrollWidth - hotSpotDiv.offsetWidth) / 2 + 'px';
    span.style.marginTop = -span.scrollHeight - 12 + 'px';
}

async function main() {
    // const map = await fetch('main.json').then(e => e.json());
    const map = await fetch(urlBaseApi).then(e => e.json());
    const scenes = map['scenes'];
    for (const keyScene in scenes) {
        const scene = scenes[keyScene];
        const hotspots = scene['hotSpots'];
        for (const hotspot of hotspots) {
            if (hotspot['type'] == 'product') {
                hotspot['createTooltipFunc'] = hotspotProduct;
            }
        }
    }

    var viewer = pannellum.viewer('panorama', map);
}
main();


function openDialog() {
    const dialogDiv = document.getElementById('div-dialog');
    dialogDiv.style.display = 'block';
}
function closeDialog() {
    const dialogDiv = document.getElementById('div-dialog');
    dialogDiv.style.display = 'none';
}