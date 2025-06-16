import { useState,useEffect} from 'react'
import axios from 'axios';
import './App.css'

const convertirFecha = (fechaStr) => {
  const [dia, mes, anio] = fechaStr.split("/").map(Number);
  return new Date(anio, mes - 1, dia);
};

function App() {
  const [listaEventos, setListaEventos] = useState([]);

  useEffect(() => {
    const listaEventosAux = [];
    const obtenerDatos = async () => {
      try {
        const res = await axios.get('https://api-vamos-a-bailar.onrender.com/api/obtieneEventos');
        if(res.data) {
          res.data.map(pagina => {
            pagina['eventos'].map(evento => {
              listaEventosAux.push(evento);
            })
          })
         }

        if (listaEventosAux && listaEventosAux.length > 0) {
          const listEventosOrdenados = [...listaEventosAux].sort((a, b) => {
            const fechaA = convertirFecha(a.fecha_f);
            const fechaB = convertirFecha(b.fecha_f);
            return fechaA - fechaB; // Orden ascendente
          });

          setListaEventos(listEventosOrdenados);
        }

      } catch (err) {
        console.error('Error al obtener los datos', err);
      }
    };

    obtenerDatos();
  }, []);

  return (
    <>
      <div className="container-header">
        <div className='header-text'>
          <span>VAMOS A BAILAR!</span>
        </div>
        <img className='banner' src="banner.png"/>
      </div>
      <div className="main-body">
        <div className='container'>
          {listaEventos &&
            listaEventos.map(evento => (
              <div className='card-img'>
                <img src={evento.img} alt="evento" />
                <div className="img-info">
                  <div className='img-info_container'>
                    <h1>{evento.titulo}</h1>
                    <h2>{evento.fecha}</h2>
                    <a href={evento.link} target='_blank'>
                      <h3>Entrar al evento</h3>
                    </a>
                  </div>
                </div>
              </div>
            ))
          }
          
        </div>
      </div>
    </>
  )
}

export default App
