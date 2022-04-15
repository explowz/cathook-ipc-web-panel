/*
*  Search engine from tf2cuntsupport.cf (was allowed use for it)
*   copyright: bluesnoop : cuntsupport ;9
*/ 

function engine() {
    let input = document.getElementById('searchengine').value;
    input = input.toLowerCase();
    let x = document.getElementsByClassName('addressengine');
      
    for (i = 0; i < x.length; i++) { 
        if (!x[i].innerHTML.toLowerCase().includes(input)) {
            x[i].style.display="none";
        } else {
            x[i].style.display="";   
        }
    }
}