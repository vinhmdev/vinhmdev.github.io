const infoProduct = {};

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
    span.innerHTML = 'Xem chi tiết';
    hotSpotDiv.appendChild(span);
    span.style.width = span.scrollWidth - 20 + 'px';
    span.style.marginLeft = -(span.scrollWidth - hotSpotDiv.offsetWidth) / 2 + 'px';
    span.style.marginTop = -span.scrollHeight - 12 + 'px';
}

async function main() {
    const map = await fetch('main.json').then(e => e.json());
    const scenes = map['scenes'];
    for (const keyScene in scenes) {
        const scene = scenes[keyScene];
        const hotspots = scene['hotSpots'];
        for (const hotspot of hotspots) {
            console.log(hotspot);
            if (hotspot['type'] == 'product') {
                hotspot['createTooltipFunc'] = hotspotProduct;
            }
        }
    }

    console.log(map);

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