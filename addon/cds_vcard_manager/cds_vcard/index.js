const navPersonal = 'nav-personal' // don't change it
const navCompany = 'nav-company' // don't change it
const navSocial = 'nav-social' // don't change it

var infoUser = {};
var urlInfo = 'https://cds-home-default-rtdb.firebaseio.com/__cds_vcard__/default.json';
const packageUser = new URLSearchParams(window.location.search).get('u');
document.getElementById('name').innerText = packageUser;

if ((packageUser ?? '') != '') {
    if (packageUser.startsWith('http')) {
        urlInfo = packageUser;
    }
    else {
        urlInfo = urlInfo.replaceAll('/default.json', `/${packageUser}.json`);
    }
}


function addItem(nav, faIcon, label, value, href) {
    if ([(label ?? ''), (value ?? '')].includes('')) {
        return;
    }
    const navPersonal = document.getElementById(nav)
    navPersonal.innerHTML += `
        <a href="${href ?? '#'}" class="alert alert-light px-3 py-2 d-flex align-items-center mb-0" role="alert" style="border-bottom: 1px solid #2222;">
            <div>
                <i class="fa ${(faIcon ?? '') == '' ? 'fa-plus' : faIcon} mb-4 fs-5 text-muted flex-shrink-0 me-3" style="position: absolute; top: 14px;" aria-hidden="true"></i>
                <i class="fa mb-4 fs-5 text-muted flex-shrink-0 mx-3" aria-hidden="true"></i>
            </div>
            <div>
                <div class="text-muted fw-bold ">${label}</div>
                <div class="text-primary fs-5">${value}</div>
            </div>
        </a>
    `;
}

async function saveVcf() {
    if ((infoUser?.length ?? 0) == 0) {
        infoUser = await fetch(urlInfo,).then((e) => e.json());
    }
    const vcf = infoUser['vcf'];
    
    const data = encodeURIComponent(vcf.split('<br/>').map((e) => `${e ?? ''}`.trim()).filter((e) => e != '').join('\n'))
    console.log(data)
    window.open("data:text/x-vcard;urlencoded," + data);
}

async function main() {
    infoUser = await fetch(urlInfo,).then((e) => e.json());

    document.getElementById('avatar').setAttribute('src', infoUser['avatar']);
    document.getElementById('name').innerText = infoUser['name'];

    infoUser['personal'].forEach((e) => {
        addItem(navPersonal, e['fa_icon'], e['label'], e['value'], e['href']);
    });
    infoUser['company'].forEach((e) => {
        addItem(navCompany, e['fa_icon'], e['label'], e['value'], e['href']);
    });
    infoUser['social'].forEach((e) => {
        addItem(navSocial, e['fa_icon'], e['label'], e['value'], e['href']);
    });
}

main();