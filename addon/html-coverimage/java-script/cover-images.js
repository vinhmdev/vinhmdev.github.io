var imgSrc = document.getElementById('img-source');
var canvasScr = document.getElementById('canvas-source');
var contextScr = canvasScr.getContext('2d');
var result = document.getElementById('result');
var gray = [];
var width = 185;
var height;

function setValue() {
    gray = [];

    var file = document.getElementById('file-anh').files[0] || null;
    if (!file) {
        imgSrc.src = '/images/megumin2.png';
    } else {
        let url = URL.createObjectURL(file);
        console.log(url);
        imgSrc.src = url;
    }

    imgSrc.onload = function() {
        width = document.getElementById('do-phuc-tap').value;
        width = Math.floor(Math.abs(width));
        height = width / imgSrc.width * imgSrc.height;

        canvasScr.width = width;
        canvasScr.height = height;

        result.style.letterSpacing = '-.2ch';
        result.style.width = width * 0.8 + 'ch';
        createChar();
    }
}


function createChar() {

    contextScr.drawImage(imgSrc, 0, 0, width, height);
    var dataImg = contextScr.getImageData(0, 0, width, height).data;

    console.log(dataImg);

    for (let i = 4; i < dataImg.length; i += 4) {
        let G = dataImg[i - 4];
        let R = dataImg[i - 3];
        let B = dataImg[i - 2];
        gray.push(this.Math.floor(R * 0.3 + G * 0.55 + B * 0.15));
    }


    var text = '';
    for (let i = 0; i < gray.length; ++i) {
        text += this.chars[gray[i]];
        if ((i + 1) % width == 0) {
            text += '<br />';
        }
    }
    result.innerHTML = text;
}

var chars = charsF();

function charsF() {
    // var ch = ['@', 'W', '8', 'Y', 'A', 'C', 'c', '+', '.', '&nbsp;', '&nbsp;'];
    var ch = ['@', 'W', '#', '$', 'w', 'k', 'd', 'o', 't', 'j', 'i', '=', '-', '.', '&nbsp;', '&nbsp;']
    var step = Math.ceil(256 / ch.length);
    var result = {};
    for (let i = 0; i < 256; ++i) {
        result[i] = ch[Math.floor(i / step)];
    }
    return result;
}

setValue()